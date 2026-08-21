import { admin, functions, db } from './lib'
import { sendPush, sendFcmToTokens, pushToTeachersAndAdmins } from './notifications-core'

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
