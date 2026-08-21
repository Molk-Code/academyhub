import { admin, functions, db } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// dailyFirestoreBackup — export Firestore to Cloud Storage every night at 02:00 Stockholm
// ─────────────────────────────────────────────────────────────────────────────

export const dailyFirestoreBackup = functions.pubsub
  .schedule('0 2 * * *')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const projectId  = process.env.GCLOUD_PROJECT ?? 'academy-hub-c252f'
    const bucket     = `gs://${projectId}.appspot.com`
    const dateStr    = new Date().toISOString().slice(0, 10)
    const outputUri  = `${bucket}/firestore-backups/${dateStr}`

    const token = await admin.app().options.credential!.getAccessToken()
    const res   = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ outputUriPrefix: outputUri }),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Firestore export failed (${res.status}): ${text}`)
    }
    console.log(`Firestore backup started → ${outputUri}`)
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// exportUserData — GDPR right of access (callable, owner or admin only)
// ─────────────────────────────────────────────────────────────────────────────

export const exportUserData = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { userId } = data as { userId?: string }
  const uid = userId ?? context.auth.uid

  // Only the account owner or an admin may export
  const callerDoc = await db.collection('users').doc(context.auth.uid).get()
  const callerRole = callerDoc.data()?.role ?? context.auth.token.role
  if (uid !== context.auth.uid && callerRole !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'You may only export your own data.')
  }

  const [
    userSnap,
    pointsSnap,
    attendanceSnap,
    submissionsSnap,
    chatSnap,
    todosSnap,
    planSnap,
    bookingsSnap,
    absenceSnap,
  ] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('points_log').where('studentId', '==', uid).get(),
    db.collectionGroup('attendance').where('studentId', '==', uid).get(),
    db.collection('submissions').where('studentId', '==', uid).get(),
    db.collectionGroup('messages').where('authorId', '==', uid).get(),
    db.collection('todos').where('studentId', '==', uid).get(),
    db.collection('development_plans').doc(uid).get(),
    db.collection('room_bookings').where('studentId', '==', uid).get(),
    db.collection('absence_reports').where('studentId', '==', uid).get(),
  ])

  const toObj = (snap: admin.firestore.DocumentSnapshot | admin.firestore.QueryDocumentSnapshot) =>
    ({ id: snap.id, ...snap.data() })

  return {
    exportedAt: new Date().toISOString(),
    profile: userSnap.exists ? toObj(userSnap) : null,
    pointsLog: pointsSnap.docs.map(toObj),
    attendance: attendanceSnap.docs.map(toObj),
    submissions: submissionsSnap.docs.map(toObj),
    chatMessages: chatSnap.docs.map(toObj),
    todos: todosSnap.docs.map(toObj),
    developmentPlan: planSnap.exists ? toObj(planSnap) : null,
    roomBookings: bookingsSnap.docs.map(toObj),
    absenceReports: absenceSnap.docs.map(toObj),
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// deleteUserData — GDPR right to erasure (callable, owner or admin only)
// ─────────────────────────────────────────────────────────────────────────────

export const deleteUserData = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { userId } = data as { userId?: string }
  const uid = userId ?? context.auth.uid

  const callerDoc = await db.collection('users').doc(context.auth.uid).get()
  const callerRole = callerDoc.data()?.role ?? context.auth.token.role
  const isAdmin    = callerRole === 'admin'
  if (uid !== context.auth.uid && !isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'You may only delete your own account.')
  }

  // BulkWriter auto-chunks unlimited writes (Firestore batches cap at 500).
  const bulk = db.bulkWriter()
  let stage = 'init'

  try {
    // Simple owned collections — delete outright
    stage = 'owned-queries'
    const ownedQueries = [
      db.collection('points_log').where('studentId', '==', uid),
      db.collection('submissions').where('studentId', '==', uid),
      db.collection('todos').where('studentId', '==', uid),
      db.collection('room_bookings').where('studentId', '==', uid),
      db.collection('absence_reports').where('studentId', '==', uid),
      db.collection('minivan_bookings').where('studentId', '==', uid),
      db.collection('food_box_orders').where('studentId', '==', uid),
      db.collection('prize_claims').where('studentId', '==', uid),
      db.collection('notifications').where('uid', '==', uid),
      db.collection('personal_events').where('userId', '==', uid),
      db.collection('equipment_bookings').where('studentId', '==', uid),
      db.collection('teacher_assessments').where('studentId', '==', uid),
      db.collection('bug_reports').where('uid', '==', uid),
    ]
    const snaps = await Promise.all(ownedQueries.map(q => q.get().catch(err => {
      console.warn('deleteUserData: owned query failed', err?.message)
      return { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }
    })))
    for (const snap of snaps) for (const d of snap.docs) bulk.delete(d.ref)

    // Anonymise attendance records (best-effort — collectionGroup index may be missing)
    stage = 'attendance'
    try {
      const attendanceSnap = await db.collectionGroup('attendance').where('studentId', '==', uid).get()
      for (const d of attendanceSnap.docs) bulk.update(d.ref, { studentName: 'Deleted User' })
    } catch (err: any) {
      console.warn('deleteUserData: attendance anonymise skipped', err?.message)
    }

    // Remove user from personal_events inviteeIds they were invited to
    stage = 'personal-events-invitees'
    const invitedSnap = await db.collection('personal_events').where('inviteeIds', 'array-contains', uid).get()
    for (const d of invitedSnap.docs) {
      const ids: string[] = d.data().inviteeIds ?? []
      bulk.update(d.ref, { inviteeIds: ids.filter(id => id !== uid) })
    }

    // Remove user from DM chat channels (leave non-DM channels as-is for history)
    stage = 'dm-channels'
    const dmSnap = await db.collection('chat_channels')
      .where('isDM', '==', true)
      .where('memberIds', 'array-contains', uid)
      .get()
    for (const d of dmSnap.docs) {
      const members: string[] = d.data().memberIds ?? []
      const remaining = members.filter(id => id !== uid)
      if (remaining.length === 0) bulk.delete(d.ref)
      else bulk.update(d.ref, { memberIds: remaining })
    }

    // Delete development plan and its teacher comments
    stage = 'plans'
    bulk.delete(db.collection('development_plans').doc(uid))
    const planCommentsSnap = await db.collection('plan_comments').where('studentId', '==', uid).get()
    for (const d of planCommentsSnap.docs) bulk.delete(d.ref)

    // Delete teacher assessments doc keyed by studentId
    bulk.delete(db.collection('teacher_assessments').doc(uid))

    // Delete user doc
    bulk.delete(db.collection('users').doc(uid))

    stage = 'bulk-close'
    await bulk.close()
  } catch (err: any) {
    console.error(`deleteUserData failed at stage=${stage}`, err)
    throw new functions.https.HttpsError('internal', `Delete failed at ${stage}: ${err?.message ?? err}`)
  }

  // Delete avatar from Storage (best-effort)
  try {
    await admin.storage().bucket().file(`avatars/${uid}`).delete()
  } catch { /* no avatar or already gone */ }

  // Revoke tokens then delete Firebase Auth account
  try { await admin.auth().revokeRefreshTokens(uid) } catch { /* best-effort */ }
  try {
    await admin.auth().deleteUser(uid)
  } catch (err: any) {
    console.warn('deleteUserData: auth delete skipped', err?.message)
  }

  // Write GDPR deletion log
  try {
    await db.collection('deletion_log').add({
      uid,
      deletedBy:  isAdmin ? context.auth.uid : uid,
      deletedAt:  admin.firestore.FieldValue.serverTimestamp(),
      method:     isAdmin ? 'admin-panel' : 'self-service',
    })
  } catch (err: any) {
    console.warn('deleteUserData: deletion_log write failed', err?.message)
  }

  return { success: true }
})

// ── One-time migration: copy cohorts → classes ───────────────────────────────
export const migrateCohortsToClasses = functions.https.onCall(async (_data, context) => {
  if (!context.auth || context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.')
  }
  const snap = await db.collection('cohorts').get()
  if (snap.empty) return { copied: 0, message: 'No cohorts found.' }
  const batch = db.batch()
  snap.docs.forEach(d => batch.set(db.collection('classes').doc(d.id), d.data()))
  await batch.commit()
  return { copied: snap.size, message: `Copied ${snap.size} cohorts → classes.` }
})
