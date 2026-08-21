import { admin, functions, db, escapeHtml, getResend } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// onUserCreate — set custom claims from invitation
// ─────────────────────────────────────────────────────────────────────────────

export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  // Find an unused invitation matching this email
  const snap = await db.collection('invitations')
    .where('email', '==', user.email)
    .where('used', '==', false)
    .limit(1)
    .get()

  if (snap.empty) {
    // No invite — set default inactive student role
    await admin.auth().setCustomUserClaims(user.uid, { role: 'student', cohortId: null })
    return
  }

  const inviteDoc = snap.docs[0]
  const invite    = inviteDoc.data()

  // Reject expired invitations
  if (invite.expiresAt && invite.expiresAt.toDate() < new Date()) {
    await admin.auth().setCustomUserClaims(user.uid, { role: 'student', cohortId: null })
    return
  }

  // Set custom claims so Firestore rules work immediately
  await admin.auth().setCustomUserClaims(user.uid, {
    role:     invite.role     ?? 'student',
    cohortId: invite.cohortId ?? null,
  })

  // Mark invite as used
  await inviteDoc.ref.update({ used: true, usedBy: user.uid, usedAt: admin.firestore.FieldValue.serverTimestamp() })
})

// ─────────────────────────────────────────────────────────────────────────────
// onUserDocUpdated — keep Auth custom claims in sync when role/cohortId changes
// ─────────────────────────────────────────────────────────────────────────────

export const onUserDocUpdated = functions.firestore
  .document('users/{uid}')
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after  = change.after.data()
    const uid    = context.params.uid

    if (before.role === after.role && before.cohortId === after.cohortId) return null

    await admin.auth().setCustomUserClaims(uid, {
      role:     after.role     ?? null,
      cohortId: after.cohortId ?? null,
    })

    return null
  })

// onUserDocCreated — backup claims setter in case the Auth onCreate trigger fails
// (e.g. cold start timeout, transient error). Fires when AcceptInvite's setDoc lands.
export const onUserDocCreated = functions.firestore
  .document('users/{uid}')
  .onCreate(async (snap, context) => {
    const uid  = context.params.uid
    const data = snap.data()
    if (!data.role) return null
    try {
      const existing = await admin.auth().getUser(uid)
      const claims   = existing.customClaims ?? {}
      if (claims.role === data.role && claims.cohortId === (data.cohortId ?? null)) return null
      await admin.auth().setCustomUserClaims(uid, {
        role:     data.role     ?? null,
        cohortId: data.cohortId ?? null,
      })
    } catch {
      // Auth user may not exist yet during seeding — ignore
    }
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// generatePasswordResetLink — admin gets a reset link to send manually (e.g. paste into email/Teams)
// ─────────────────────────────────────────────────────────────────────────────

export const generatePasswordResetLink = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  }
  const { email } = data as { email: string }
  if (!email) throw new functions.https.HttpsError('invalid-argument', 'email required.')
  const link = await admin.auth().generatePasswordResetLink(email, {
    url: 'https://academy-hub-c252f.web.app/login',
  })
  return { link }
})

// sendInviteEmail — create an invitation document and email the invite link via Resend
// ─────────────────────────────────────────────────────────────────────────────

export const sendInviteEmail = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
    if (context.auth.token.role !== 'admin') {
      throw new functions.https.HttpsError('permission-denied', 'Admin only.')
    }

    const { email, role, cohortId, appUrl } = data as {
      email: string
      role: string
      cohortId?: string | null
      appUrl: string
    }
    if (!email) throw new functions.https.HttpsError('invalid-argument', 'email required.')

    const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
    const ref = await db.collection('invitations').add({
      email,
      role:      role ?? 'student',
      cohortId:  cohortId ?? null,
      used:      false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
    })

    const inviteUrl = `${appUrl}/accept-invite?token=${ref.id}`

    const emailCfgSnap = await db.collection('email_config').doc('global').get()
    const emailCfg     = emailCfgSnap.data()
    const fromEmail    = emailCfg?.fromEmail
    const fromName     = emailCfg?.fromName || 'AcademyHub'

    if (fromEmail && fromEmail !== 'onboarding@resend.dev') {
      await getResend().emails.send({
        from:    `${fromName} <${fromEmail}>`,
        to:      email,
        subject: `You're invited to ${fromName}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
            <h2 style="margin-bottom:8px">You've been invited</h2>
            <p style="color:#555;margin-bottom:24px">
              You have been invited to join ${escapeHtml(fromName)} as a <strong>${escapeHtml(role)}</strong>.
              Click the button below to create your account. This link expires in 7 days.
            </p>
            <a href="${inviteUrl}"
               style="display:inline-block;background:#f97316;color:white;text-decoration:none;
                      padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px">
              Accept invitation
            </a>
            <p style="color:#999;font-size:12px;margin-top:24px">
              If you didn't expect this email, you can safely ignore it.
            </p>
          </div>
        `,
      })
    }

    return { inviteId: ref.id, inviteUrl, emailSent: !!(fromEmail && fromEmail !== 'onboarding@resend.dev') }
  })

// sendPasswordResetLink — generate a Firebase reset link and deliver it via Resend
// Uses the school's verified sender domain instead of Firebase's firebaseapp.com domain,
// which gets blocked by corporate/government mail servers.
// ─────────────────────────────────────────────────────────────────────────────

export const sendPasswordResetLink = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
    if (context.auth.token.role !== 'admin') {
      throw new functions.https.HttpsError('permission-denied', 'Admin only.')
    }

    const { email } = data as { email: string }
    if (!email) throw new functions.https.HttpsError('invalid-argument', 'email required.')

    const emailCfgSnap = await db.collection('email_config').doc('global').get()
    const emailCfg     = emailCfgSnap.data()
    const fromEmail    = emailCfg?.fromEmail
    if (!fromEmail || fromEmail === 'onboarding@resend.dev') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'No verified sender email configured. Set fromEmail in Admin → Email Settings.'
      )
    }

    const resetLink = await admin.auth().generatePasswordResetLink(email, {
      url: 'https://academy-hub-c252f.web.app/login',
    })

    await getResend().emails.send({
      from:    fromEmail,
      to:      email,
      subject: 'Reset your CineForge password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
          <h2 style="margin-bottom:8px">Reset your password</h2>
          <p style="color:#555;margin-bottom:24px">
            An administrator has requested a password reset for your CineForge account.
            Click the button below to choose a new password.
          </p>
          <a href="${resetLink}"
             style="display:inline-block;background:#f97316;color:white;text-decoration:none;
                    padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px">
            Reset password
          </a>
          <p style="color:#999;font-size:12px;margin-top:24px">
            This link expires in 1 hour. If you didn't expect this email, you can ignore it.
          </p>
        </div>
      `,
    })

    return { success: true }
  })

// resetPassword — admin sets a new password for any non-admin user
// ─────────────────────────────────────────────────────────────────────────────

export const resetPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can reset passwords.')
  }

  const { uid, newPassword } = data as { uid: string; newPassword: string }
  if (!uid)                               throw new functions.https.HttpsError('invalid-argument', 'uid is required.')
  if (!newPassword || newPassword.length < 6) throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters.')

  // Prevent resetting another admin's password
  const target = await admin.auth().getUser(uid)
  if ((target.customClaims as any)?.role === 'admin') {
    throw new functions.https.HttpsError('permission-denied', "Cannot reset another admin's password.")
  }

  await admin.auth().updateUser(uid, { password: newPassword })
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// disableUser — disable Firebase Auth account + mark Firestore doc disabled
// ─────────────────────────────────────────────────────────────────────────────

export const disableUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const callerDoc = await db.collection('users').doc(context.auth.uid).get()
  const callerRole = callerDoc.data()?.role
  if (callerRole !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  }
  const { uid } = data as { uid: string }
  await admin.auth().updateUser(uid, { disabled: true })
  await admin.auth().revokeRefreshTokens(uid)
  await db.collection('users').doc(uid).update({ disabled: true, isActive: false })
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// restoreUser — re-enable Firebase Auth account + clear disabled flag
// ─────────────────────────────────────────────────────────────────────────────

export const restoreUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const callerDoc = await db.collection('users').doc(context.auth.uid).get()
  const callerRole = callerDoc.data()?.role
  if (callerRole !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  }
  const { uid } = data as { uid: string }
  await admin.auth().updateUser(uid, { disabled: false })
  await db.collection('users').doc(uid).update({ disabled: false, isActive: true })
  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// inspectUserClaims — admin: get + optionally clear stale cohortId claim
// Usage: { uid, fix: false } → inspect only  |  { uid, fix: true } → clear claim
// ─────────────────────────────────────────────────────────────────────────────

export const inspectUserClaims = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.')

  const uid = data?.uid as string | undefined
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required.')

  const userRecord = await admin.auth().getUser(uid)
  const claims     = userRecord.customClaims ?? {}
  const firestoreSnap = await db.collection('users').doc(uid).get()
  const firestoreDoc  = firestoreSnap.exists ? firestoreSnap.data() : null

  const report = {
    uid,
    email:             userRecord.email,
    claimRole:         claims.role     ?? null,
    claimCohortId:     claims.cohortId ?? null,
    firestoreRole:     firestoreDoc?.role     ?? null,
    firestoreCohortId: firestoreDoc?.cohortId ?? null,
    mismatch:          (claims.cohortId ?? null) !== (firestoreDoc?.cohortId ?? null),
    fixed:             false,
  }

  if (data?.fix === true && report.mismatch) {
    await admin.auth().setCustomUserClaims(uid, {
      ...claims,
      cohortId: firestoreDoc?.cohortId ?? null,
    })
    report.fixed = true
  }

  return report
})

// ─────────────────────────────────────────────────────────────────────────────
// setUserRole — admin sets a user's primary role and updates Auth custom claims immediately
// ─────────────────────────────────────────────────────────────────────────────

export const setUserRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.')

  const { uid, role, roles } = data as { uid: string; role: string; roles: string[] }
  if (!uid || !role) throw new functions.https.HttpsError('invalid-argument', 'uid and role required.')
  if (uid === context.auth.uid) throw new functions.https.HttpsError('permission-denied', 'Admins cannot change their own role.')
  const allowedRoles = ['student', 'teacher', 'admin']
  if (!allowedRoles.includes(role)) throw new functions.https.HttpsError('invalid-argument', 'Invalid role.')
  if (!Array.isArray(roles) || roles.some(r => !allowedRoles.includes(r))) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid roles array.')
  }
  // Enforce role combination rules: students can't have staff roles; staff can't have student role
  const isStaffRole = (r: string) => r === 'teacher' || r === 'admin'
  if (role === 'student' && roles.some(isStaffRole)) {
    throw new functions.https.HttpsError('invalid-argument', 'Students cannot have teacher or admin roles.')
  }
  if (isStaffRole(role) && roles.includes('student')) {
    throw new functions.https.HttpsError('invalid-argument', 'Teachers and admins cannot have the student role.')
  }

  let userRecord: admin.auth.UserRecord
  try { userRecord = await admin.auth().getUser(uid) } catch {
    throw new functions.https.HttpsError('not-found', 'User not found in Firebase Auth.')
  }
  const existingClaims = userRecord.customClaims ?? {}
  await admin.auth().setCustomUserClaims(uid, { ...existingClaims, role, cohortId: null })
  await db.collection('users').doc(uid).update({ role, roles })

  return { success: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// fixAllTeacherClaims — admin: scan all teacher/admin users and clear stale cohortId claims
// ─────────────────────────────────────────────────────────────────────────────

export const fixAllTeacherClaims = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.')

  const usersSnap = await db.collection('users')
    .where('role', 'in', ['teacher', 'admin'])
    .get()

  const results: { uid: string; email: string; was: string | null; fixed: boolean }[] = []

  for (const docSnap of usersSnap.docs) {
    const fsData  = docSnap.data()
    const uid     = docSnap.id
    let userRecord: admin.auth.UserRecord
    try { userRecord = await admin.auth().getUser(uid) } catch { continue }
    const claims = userRecord.customClaims ?? {}
    const claimCohortId = claims.cohortId ?? null
    if (claimCohortId !== null) {
      await admin.auth().setCustomUserClaims(uid, { ...claims, cohortId: null })
      results.push({ uid, email: userRecord.email ?? '', was: claimCohortId, fixed: true })
    } else {
      results.push({ uid, email: userRecord.email ?? '', was: null, fixed: false })
    }
  }

  return { scanned: results.length, fixed: results.filter(r => r.fixed).length, results }
})

// ─────────────────────────────────────────────────────────────────────────────
// findDuplicateUserDocs — finds users/{uid} docs where doc.id !== doc.uid field
// (orphan docs from old seeding scripts or addDoc creation paths).
// Pass { merge: true } to merge each orphan into the canonical doc and delete it.
// ─────────────────────────────────────────────────────────────────────────────

export const findDuplicateUserDocs = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  if (context.auth.token.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.')

  const merge = data?.merge === true
  const snap  = await db.collection('users').get()

  type Result = { docId: string; uid: string | null; email: string | null; action: string }
  const results: Result[] = []

  for (const d of snap.docs) {
    const uid: string | null = d.data().uid ?? null
    if (!uid || uid === d.id) continue  // no uid field or already canonical

    const result: Result = { docId: d.id, uid, email: d.data().email ?? null, action: 'found' }

    if (merge) {
      // Check if canonical doc (doc.id === uid) already exists
      const canonicalRef = db.collection('users').doc(uid)
      const canonical    = await canonicalRef.get()

      if (canonical.exists) {
        // Canonical doc exists — just delete the orphan
        await d.ref.delete()
        result.action = 'deleted-orphan'
      } else {
        // No canonical doc — migrate orphan to the correct UID-keyed doc
        await canonicalRef.set(d.data())
        await d.ref.delete()
        result.action = 'migrated-to-canonical'
      }
    }

    results.push(result)
  }

  return { total: snap.size, orphans: results.length, results }
})
