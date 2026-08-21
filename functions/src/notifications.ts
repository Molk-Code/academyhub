import { admin, functions, db } from './lib'

// ─────────────────────────────────────────────────────────────────────────────
// purgeChatMessages — delete messages older than the configured retention window
// ─────────────────────────────────────────────────────────────────────────────

export const purgeChatMessages = functions.pubsub.schedule('every 24 hours').onRun(async () => {
  const settingsSnap = await db.collection('chat_settings').doc('global').get()
  if (!settingsSnap.exists) return null

  const retentionDays: number | null = settingsSnap.data()?.retentionDays ?? null
  if (retentionDays === null) return null  // "Forever" — nothing to delete

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff)

  const channelsSnap = await db.collection('chat_channels').get()
  for (const channelDoc of channelsSnap.docs) {
    const oldMessages = await channelDoc.ref
      .collection('messages')
      .where('createdAt', '<', cutoffTs)
      .get()
    const batch = db.batch()
    oldMessages.docs.forEach(d => batch.delete(d.ref))
    if (!oldMessages.empty) await batch.commit()
  }
  return null
})

// ─────────────────────────────────────────────────────────────────────────────
// Push notification helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function sendPush(
  tokens: string[],
  opts: { title: string; body: string; url?: string; tag?: string },
) {
  if (tokens.length === 0) return
  const uniqueTokens = [...new Set(tokens)]
  try {
    for (let i = 0; i < uniqueTokens.length; i += 500) {
      const chunk = uniqueTokens.slice(i, i + 500)
      const res = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        // Data-only — no notification field so FCM does not auto-display.
        // The service worker's onBackgroundMessage handler is the sole display path.
        data: {
          title: opts.title,
          body:  opts.body,
          url:   opts.url ?? '/',
          tag:   opts.tag ?? 'cineforge',
        },
        webpush: {
          headers: { Urgency: 'high' },
        },
      })
      const successCount = res.responses.filter(r => r.success).length
      const failCount    = res.responses.filter(r => !r.success).length
      console.log('sendPush result', {
        title: opts.title,
        tokenCount: chunk.length,
        successCount,
        failCount,
        errors: res.responses.filter(r => !r.success).map(r => r.error?.message),
      })
      // Remove stale tokens that are no longer registered
      const stale = res.responses
        .map((r, idx) => (!r.success ? chunk[idx] : null))
        .filter(Boolean) as string[]
      if (stale.length > 0) {
        const usersSnap = await db.collection('users')
          .where('fcmTokens', 'array-contains-any', stale)
          .get()
        await Promise.all(usersSnap.docs.map(d =>
          d.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...stale) }),
        ))
      }
    }
  } catch (err: any) {
    console.error('sendPush error', { message: err?.message })
  }
}

export async function saveNotifications(
  uids: string[],
  opts: { title: string; body: string; url?: string },
) {
  if (uids.length === 0) return
  const batch = db.batch()
  for (const uid of uids) {
    const ref = db.collection('notifications').doc()
    batch.set(ref, {
      uid,
      title:     opts.title,
      body:      opts.body,
      url:       opts.url ?? '/',
      isRead:    false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Booking notification helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function getOrCreateBookingsChannel(): Promise<string> {
  const snap = await db.collection('chat_channels')
    .where('name', '==', 'Bookings')
    .limit(1)
    .get()

  if (!snap.empty) return snap.docs[0].id

  const ref = await db.collection('chat_channels').add({
    name:             'Bookings',
    description:      'Food box orders and minivan requests',
    order:            99,
    isPublic:         false,
    allowedRoles:     ['teacher', 'admin'],
    allowedCohortIds: [],
    allowedTeamIds:   [],
    memberIds:        [],
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
    createdBy:        'system',
  })
  return ref.id
}

export async function postToBookingsChannel(channelId: string, text: string) {
  await db.collection('chat_channels').doc(channelId)
    .collection('messages').add({
      authorId:        'system',
      authorName:      'CineForge',
      authorAvatarUrl: null,
      content:         text,
      attachments:     [],
      reactions:       {},
      skipPush:        true,   // prevent onChatMessage from sending a duplicate push
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
    })
  await db.collection('chat_channels').doc(channelId).update({
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

export async function pushToTeachersAndAdmins(title: string, body: string, url: string) {
  const snap = await db.collection('users')
    .where('role', 'in', ['teacher', 'admin'])
    .get()
  const tokens: string[] = []
  const uids: string[] = []
  snap.docs.forEach(d => {
    tokens.push(...(d.data().fcmTokens ?? []))
    uids.push(d.id)
  })
  await Promise.all([
    sendPush(tokens, { title, body, url, tag: 'booking' }),
    saveNotifications(uids, { title, body, url }),
  ])
}

export async function pushToStudent(studentId: string, title: string, body: string) {
  const snap = await db.collection('users').doc(studentId).get()
  const tokens: string[] = snap.data()?.fcmTokens ?? []
  await sendPush(tokens, { title, body, url: '/booking', tag: 'booking-update' })
}

// ─────────────────────────────────────────────────────────────────────────────
// sendEventInviteNotifications — callable: send invite push to invitees
// ─────────────────────────────────────────────────────────────────────────────

export const sendEventInviteNotifications = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in')

  // Verify the caller owns the event they are notifying about
  const eventId: string = data.eventId ?? ''
  if (!eventId) throw new functions.https.HttpsError('invalid-argument', 'eventId is required')
  const eventSnap = await db.collection('personal_events').doc(eventId).get()
  if (!eventSnap.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
  if (eventSnap.data()!.userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You can only send notifications for events you created')
  }

  const inviteeIds: string[] = (data.inviteeIds ?? []).slice(0, 50)
  if (!inviteeIds.length) return { sent: 0 }

  const organizerName: string = data.organizerName ?? 'Someone'
  const title: string         = data.title ?? 'Meeting'
  const dateStr: string       = data.dateStr ?? ''
  const timeStr: string       = data.timeStr ?? ''
  const location: string      = data.location ?? ''
  const canceled: boolean     = data.canceled === true
  const locationPart          = location ? ` · ${location}` : ''

  const tokens: string[] = (await Promise.all(
    inviteeIds.map(async uid => {
      // Primary: look up by document ID (inviteeIds now stores the Firestore doc ID = auth UID)
      const byId = await db.collection('users').doc(uid).get()
      if (byId.exists) {
        const tokens = (byId.data()?.fcmTokens ?? []) as string[]
        if (tokens.length) return tokens
      }
      // Fallback: query by uid field (for any legacy stored values)
      const byField = await db.collection('users').where('uid', '==', uid).get()
      return byField.docs.flatMap(d => (d.data().fcmTokens ?? []) as string[])
    })
  )).flat()
  if (!tokens.length) return { sent: 0 }

  const pushTitle = canceled
    ? `❌ ${organizerName} canceled: "${title}"`
    : `📅 ${organizerName} invited you: "${title}"`
  const pushBody = canceled ? '' : `${dateStr} at ${timeStr}${locationPart}`

  await sendPush(tokens, {
    title: pushTitle,
    body:  pushBody,
    url:   '/calendar',
    tag:   `event-invite-${context.auth.uid}-${Date.now()}`,
  })

  return { sent: tokens.length }
})

// ─────────────────────────────────────────────────────────────────────────────
// sendEventReminders — push notification 15 min before calendar events
// Runs every 5 minutes; sends to events starting in 13–18 min window
// ─────────────────────────────────────────────────────────────────────────────

async function sendFcmToTokens(tokens: string[], title: string, body: string): Promise<void> {
  if (!tokens.length) return
  const messaging = admin.messaging()
  // Send in batches of 500 (FCM multicast limit)
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500)
    await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data: { title, body, tag: 'event-reminder' },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'event-reminder',
        },
      },
    })
  }
}

export { sendFcmToTokens }

export const sendEventReminders = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async () => {
    const now     = Date.now()
    const winFrom = new Date(now + 13 * 60 * 1000)  // 13 min from now
    const winTo   = new Date(now + 18 * 60 * 1000)  // 18 min from now

    const fromTs = admin.firestore.Timestamp.fromDate(winFrom)
    const toTs   = admin.firestore.Timestamp.fromDate(winTo)

    // ── Lesson events ────────────────────────────────────────────────────────
    const lessonsSnap = await db.collection('lessons')
      .where('startTime', '>=', fromTs)
      .where('startTime', '<=', toTs)
      .get()

    for (const lessonDoc of lessonsSnap.docs) {
      const lesson = lessonDoc.data()
      const startTime: admin.firestore.Timestamp = lesson.startTime
      const timeStr = startTime.toDate().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
      const title   = lesson.title ?? 'Lesson'
      const notifTitle = `Upcoming: ${title}`
      const notifBody  = `Starts at ${timeStr}${lesson.classroom ? ` · ${lesson.classroom}` : ''}`

      // Notify all students in this cohort
      if (lesson.cohortId) {
        const studentsSnap = await db.collection('users')
          .where('cohortId', '==', lesson.cohortId)
          .where('isActive', '==', true)
          .get()
        const studentTokens = studentsSnap.docs
          .flatMap(d => (d.data().fcmTokens as string[] | undefined) ?? [])
          .filter(Boolean)
        await sendFcmToTokens(studentTokens, notifTitle, notifBody)
      }

      // Notify the teacher(s) on this lesson
      const teacherIds: string[] = [
        ...(lesson.teacherIds ?? []),
        ...(lesson.teacherId ? [lesson.teacherId] : []),
      ].filter((v, i, a) => v && a.indexOf(v) === i)

      for (const tid of teacherIds) {
        const tSnap = await db.collection('users').doc(tid).get()
        const tokens: string[] = (tSnap.data()?.fcmTokens ?? []) as string[]
        await sendFcmToTokens(tokens, notifTitle, notifBody)
      }
    }

    // ── Personal events ──────────────────────────────────────────────────────
    const personalSnap = await db.collection('personal_events')
      .where('startTime', '>=', fromTs)
      .where('startTime', '<=', toTs)
      .get()

    for (const evDoc of personalSnap.docs) {
      const ev = evDoc.data()
      const startTime: admin.firestore.Timestamp = ev.startTime
      const timeStr = startTime.toDate().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
      const notifTitle = `Upcoming: ${ev.title ?? 'Personal event'}`
      const notifBody  = `Starts at ${timeStr}${ev.location ? ` · ${ev.location}` : ''}`

      const uSnap  = await db.collection('users').doc(ev.userId).get()
      const ownerTokens: string[] = (uSnap.data()?.fcmTokens ?? []) as string[]

      const inviteeIds: string[] = ev.inviteeIds ?? []
      const inviteeTokens: string[] = []
      if (inviteeIds.length > 0) {
        const inviteeSnaps = await Promise.all(inviteeIds.map(uid => db.collection('users').doc(uid).get()))
        inviteeSnaps.forEach(s => inviteeTokens.push(...((s.data()?.fcmTokens ?? []) as string[])))
      }

      await sendFcmToTokens([...ownerTokens, ...inviteeTokens], notifTitle, notifBody)
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// dailyTeacherSummary — Mon–Fri 08:00 morning briefing push to teachers/admins
// ─────────────────────────────────────────────────────────────────────────────

export const dailyTeacherSummary = functions.pubsub
  .schedule('0 8 * * 1-5')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const today    = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const todayStr = today.toISOString().slice(0, 10)

    const [lessonsSnap, equipmentSnap, absenceSnap, overdueSnap] = await Promise.all([
      db.collection('lessons')
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(today))
        .where('startTime', '<',  admin.firestore.Timestamp.fromDate(tomorrow))
        .get(),
      db.collection('equipment_bookings').where('status', '==', 'pending').get(),
      db.collection('absence_reports').where('status', '==', 'pending').get(),
      db.collection('inventory_projects').where('status', '==', 'checked-out').where('returnDate', '<', todayStr).get(),
    ])

    const parts: string[] = []
    if (lessonsSnap.size    > 0) parts.push(`${lessonsSnap.size} lesson${lessonsSnap.size > 1 ? 's' : ''} today`)
    if (equipmentSnap.size  > 0) parts.push(`${equipmentSnap.size} equipment request${equipmentSnap.size > 1 ? 's' : ''}`)
    if (absenceSnap.size    > 0) parts.push(`${absenceSnap.size} absence report${absenceSnap.size > 1 ? 's' : ''}`)
    if (overdueSnap.size    > 0) parts.push(`${overdueSnap.size} overdue return${overdueSnap.size > 1 ? 's' : ''}`)

    if (parts.length === 0) return null

    const dateLabel = new Intl.DateTimeFormat('en-SE', { weekday: 'long', day: 'numeric', month: 'short' }).format(today)
    await pushToTeachersAndAdmins(
      `☀️ Good morning — ${dateLabel}`,
      parts.join(' · '),
      '/teacher',
    )
    return null
  })
