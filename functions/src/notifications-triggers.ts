import { admin, functions, db } from './lib'
import { sendPush, saveNotifications } from './notifications-core'

// ─────────────────────────────────────────────────────────────────────────────
// onAssignmentPublished — push to all students in the cohort
// ─────────────────────────────────────────────────────────────────────────────

export const onAssignmentPublished = functions.firestore
  .document('assignments/{id}')
  .onWrite(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (!after || before?.isPublished === after.isPublished) return
    if (!after.isPublished) return

    const cohortId = after.cohortId as string | undefined
    if (!cohortId) return

    const studentsSnap = await db.collection('users')
      .where('cohortId', '==', cohortId)
      .where('role', '==', 'student')
      .get()

    const tokens: string[] = []
    studentsSnap.docs.forEach(d => tokens.push(...(d.data().fcmTokens ?? [])))

    const opts = {
      title: '📋 New assignment posted',
      body:  after.title ?? 'A new assignment has been published.',
      url:   '/assignments',
    }
    await Promise.all([
      sendPush(tokens, { ...opts, tag: 'assignment' }),
      saveNotifications(studentsSnap.docs.map(d => d.id), opts),
    ])
  })

// ─────────────────────────────────────────────────────────────────────────────
// onSubmissionCreated — push to cohort teachers when a student submits an assignment
// ─────────────────────────────────────────────────────────────────────────────
export const onSubmissionCreated = functions.firestore
  .document('submissions/{submissionId}')
  .onCreate(async (snap) => {
    const data = snap.data()
    if (data.status !== 'submitted') return  // skip auto-graded (status='graded')

    const cohortId    = data.cohortId as string | undefined
    const studentId   = data.studentId as string | undefined
    const assignmentId = data.assignmentId as string | undefined
    if (!cohortId || !studentId) return

    const [cohortSnap, studentSnap, assignmentSnap] = await Promise.all([
      db.collection('cohorts').doc(cohortId).get(),
      db.collection('users').doc(studentId).get(),
      assignmentId ? db.collection('assignments').doc(assignmentId).get() : Promise.resolve(null),
    ])

    const teacherIds: string[] = cohortSnap.data()?.teacherIds ?? []
    if (teacherIds.length === 0) return

    const studentName    = studentSnap.data()?.displayName ?? 'A student'
    const assignmentTitle = assignmentSnap?.data()?.title ?? 'an assignment'

    const teacherSnaps = await Promise.all(teacherIds.map(uid => db.collection('users').doc(uid).get()))
    const tokens: string[] = []
    teacherSnaps.forEach(d => tokens.push(...(d.data()?.fcmTokens ?? [])))

    const opts = {
      title: '📝 Submission ready to grade',
      body:  `${studentName} submitted "${assignmentTitle}"`,
      url:   `/teacher/gradebook?submission=${snap.id}`,
    }
    await Promise.all([
      tokens.length > 0 ? sendPush(tokens, { ...opts, tag: 'submission' }) : Promise.resolve(),
      saveNotifications(teacherIds, opts),
    ])
  })

// ─────────────────────────────────────────────────────────────────────────────
// onChatMessage — push notification to all channel members except the sender
// ─────────────────────────────────────────────────────────────────────────────

export const onChatMessage = functions.firestore
  .document('chat_channels/{channelId}/messages/{msgId}')
  .onCreate(async (snap, context) => {
    const msg = snap.data()

    // Booking system posts set skipPush to avoid double notifications
    if (msg.skipPush === true) return null

    // Atomic idempotency guard — prevents race between concurrent function instances
    const msgRef = snap.ref
    const alreadySent = await db.runTransaction(async tx => {
      const fresh = await tx.get(msgRef)
      if (fresh.data()?.pushSent === true) return true
      tx.update(msgRef, { pushSent: true })
      return false
    })
    if (alreadySent) return null

    const senderId   = (msg.authorId   as string) || ''
    const senderName = (msg.authorName as string) || 'Someone'
    const messageText = ((msg.content as string) ?? '').slice(0, 100)
                      || (msg.attachments?.length ? '📎 Attachment' : '')

    const channelId = context.params.channelId

    // Fetch channel doc
    const channelDoc = await db.collection('chat_channels').doc(channelId).get()
    const isDM = channelDoc.data()?.isDM === true
    const channelName = isDM ? null : (channelDoc.exists ? ((channelDoc.data()?.name as string) ?? 'Chat') : 'Chat')

    // Collect FCM tokens — DMs only push to the other member, channels push to all
    const tokens: string[] = []

    const ch = channelDoc.data() ?? {}
    const isPublic        = ch.isPublic !== false
    const allowedRoles    = (ch.allowedRoles    ?? []) as string[]
    const allowedCohortIds = (ch.allowedCohortIds ?? []) as string[]
    const chMemberIds     = (ch.memberIds        ?? []) as string[]

    if (isDM) {
      // DMs: only notify the other member
      await Promise.all(
        chMemberIds.filter(uid => uid !== senderId).map(async uid => {
          const u = await db.collection('users').doc(uid).get()
          ;(u.data()?.fcmTokens ?? []).forEach((t: string) => { if (t) tokens.push(t) })
        }),
      )
    } else {
      // Channel: apply same access rules as client-side canAccessChannel()
      const usersSnap = await db.collection('users').get()
      usersSnap.forEach(userDoc => {
        if (userDoc.id === senderId) return
        const u = userDoc.data()
        const userRole: string = u.role ?? ''
        const userRoles: string[] = u.roles?.length ? u.roles : [userRole]
        const userCohortId: string | null = u.cohortId ?? null
        const isStaff = userRoles.some((r: string) => r === 'teacher' || r === 'admin')

        const canAccess = isStaff
          || isPublic && allowedRoles.length === 0 && allowedCohortIds.length === 0 && chMemberIds.length === 0
          || allowedRoles.some(r => userRoles.includes(r))
          || chMemberIds.includes(userDoc.id)
          || (userCohortId !== null && allowedCohortIds.includes(userCohortId))

        if (canAccess) {
          const fcmTokens = u.fcmTokens
          if (Array.isArray(fcmTokens)) {
            fcmTokens.forEach((t: string) => { if (t) tokens.push(t) })
          }
        }
      })
    }

    if (tokens.length === 0) return null

    // Deduplicate
    const uniqueTokens = [...new Set(tokens)]

    const notifBody = channelName ? `#${channelName}\n${messageText}` : messageText
    console.log('onChatMessage: sending', { channelId, isDM, senderName, channelName, tokenCount: uniqueTokens.length })

    // Send in batches of 500 (FCM multicast limit), clean up stale tokens
    const staleTokens: string[] = []
    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const chunk = uniqueTokens.slice(i, i + 500)
      const resp = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        // Data-only — service worker's onBackgroundMessage is the sole display path.
        data: {
          type:      isDM ? 'dm' : 'chat',
          channelId,
          title:     senderName,
          body:      notifBody,
          url:       '/chat',
          tag:       `chat-${channelId}`,
        },
        webpush: {
          headers: { Urgency: 'high' },
        },
      })
      resp.responses.forEach((r, idx) => {
        if (r.error?.code === 'messaging/invalid-registration-token' ||
            r.error?.code === 'messaging/registration-token-not-registered') {
          staleTokens.push(chunk[idx])
        }
      })
    }

    // Remove stale tokens from user docs so they don't accumulate
    if (staleTokens.length > 0) {
      const staleSet = new Set(staleTokens)
      const usersWithStale = await db.collection('users')
        .where('fcmTokens', 'array-contains-any', staleTokens.slice(0, 10))
        .get()
      await Promise.all(
        usersWithStale.docs.map(d =>
          d.ref.update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...[...staleSet]),
          }),
        ),
      )
    }

    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onPlanComment — push notification to student when teacher leaves feedback
// ─────────────────────────────────────────────────────────────────────────────

export const onPlanComment = functions.firestore
  .document('plan_comments/{commentId}')
  .onCreate(async (snap) => {
    const data = snap.data()
    const studentId: string = data.studentId
    const teacherName: string = data.teacherName ?? 'Your teacher'
    const step: string = data.step ?? 'your plan'

    const stepLabels: Record<string, string> = {
      situation:  'Now',
      goal:       'Objective',
      obstacles:  'Problems',
      resources:  'Resources',
      action:     'Actions',
      evaluation: 'Evaluation',
    }
    const stepLabel = stepLabels[step] ?? step

    const userSnap = await db.collection('users').doc(studentId).get()
    const tokens: string[] = userSnap.data()?.fcmTokens ?? []
    if (!tokens.length) return null

    const planOpts = {
      title: teacherName,
      body:  `New feedback on ${stepLabel} in your development plan.`,
      url:   '/my-plan',
    }
    await Promise.all([
      sendPush(tokens, { ...planOpts, tag: 'plan-comment' }),
      saveNotifications([studentId], planOpts),
    ])
    return null
  })
