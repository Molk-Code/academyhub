import { admin, functions, db, LIMITS, requireMember, requireAllowed, REGION } from './lib'
import { sendPush, sendFcmToTokens, pushToTeachersAndAdmins, saveNotifications, tokensFor } from './notifications-core'
import { claimOnce, stockholmDate, stockholmTime, stockholmDayBounds } from './jobs'

// ─────────────────────────────────────────────────────────────────────────────
// purgeChatMessages — delete messages older than the configured retention window
// ─────────────────────────────────────────────────────────────────────────────

export const purgeChatMessages = functions.region(REGION).runWith(LIMITS).pubsub.schedule('every 24 hours').onRun(async () => {
  const settingsSnap = await db.collection('chat_settings').doc('global').get()
  if (!settingsSnap.exists) return null

  const retentionDays: number | null = settingsSnap.data()?.retentionDays ?? null
  if (retentionDays === null) return null  // "Forever" — nothing to delete

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff)

  // Pages of 400 through BulkWriter — one batch can hold only 500 writes, and a
  // single failing channel must not stop the clean-up for the others
  const channelsSnap = await db.collection('chat_channels').get()
  for (const channelDoc of channelsSnap.docs) {
    try {
      for (;;) {
        const page = await channelDoc.ref.collection('messages')
          .where('createdAt', '<', cutoffTs)
          .limit(400)
          .get()
        if (page.empty) break
        const bulk = db.bulkWriter()
        page.docs.forEach(d => { bulk.delete(d.ref) })
        await bulk.close()
        if (page.size < 400) break
      }
    } catch (err) {
      console.error('purgeChatMessages: channel failed', channelDoc.id, err)
    }
  }
  return null
})

// ─────────────────────────────────────────────────────────────────────────────
// sendInventoryReturnReminders — daily reminder to borrowers of equipment due
// today or overdue
// ─────────────────────────────────────────────────────────────────────────────

export const sendInventoryReturnReminders = functions.region(REGION).runWith(LIMITS).pubsub
  .schedule('0 8 * * *')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const todayStr = stockholmDate(new Date())
    const activeStatuses = new Set(['active', 'checked-out'])

    async function notify(doc: FirebaseFirestore.QueryDocumentSnapshot, title: string, body: string, tag: string) {
      const project = doc.data()
      const borrowerIds: string[] = project.borrowerIds ?? []
      if (borrowerIds.length === 0) return
      if (!(await claimOnce(`${tag}__${doc.id}__${todayStr}`))) return   // once a day, even on a retry
      const usersSnaps = await Promise.all(borrowerIds.map(uid => db.collection('users').doc(uid).get()))
      const tokens = await tokensFor(usersSnaps.map(s => s.id))
      const opts = { title, body, url: '/my-bookings' }
      await Promise.all([
        sendPush(tokens, { ...opts, tag: `${tag}-${doc.id}` }),
        saveNotifications(borrowerIds, opts),
      ])
    }

    const [dueSnap, overdueSnap] = await Promise.all([
      db.collection('inventory_projects').where('returnDate', '==', todayStr).get(),
      db.collection('inventory_projects').where('returnDate', '<', todayStr).get(),
    ])

    for (const doc of dueSnap.docs) {
      const status = doc.data().status
      if (!activeStatuses.has(status)) continue
      await notify(doc, '⏰ Equipment due today', `"${doc.data().name}" is due back today`, 'inventory-due')
    }

    for (const doc of overdueSnap.docs) {
      const status = doc.data().status
      if (!activeStatuses.has(status)) continue
      const overdueDays = Math.round((Date.parse(todayStr) - Date.parse(doc.data().returnDate)) / 86400000)
      await notify(
        doc,
        '🚨 Equipment overdue',
        `"${doc.data().name}" is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue — please return it`,
        'inventory-overdue',
      )
    }
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// sendEquipmentBookingOverdueReminders — daily reminder to the booking student
// for checked-out equipment bookings past their return date. Skips bookings
// already tracked in inventory_projects (linkedProjectId set) — those are
// covered by sendInventoryReturnReminders above, so this only fills the gap
// for checked-out bookings a teacher never converted into an inventory
// project.
// ─────────────────────────────────────────────────────────────────────────────

export const sendEquipmentBookingOverdueReminders = functions.region(REGION).runWith(LIMITS).pubsub
  .schedule('0 8 * * *')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const todayStr = stockholmDate(new Date())

    const overdueSnap = await db.collection('equipment_bookings')
      .where('status', '==', 'checked-out')
      .where('returnDate', '<', todayStr)
      .get()

    for (const bookingDoc of overdueSnap.docs) {
      const booking = bookingDoc.data()
      if (booking.linkedProjectId) continue  // already covered by the inventory reminder
      if (!booking.studentId) continue
      if (!(await claimOnce(`equipment-overdue__${bookingDoc.id}__${todayStr}`))) continue

      const overdueDays = Math.round((Date.parse(todayStr) - Date.parse(booking.returnDate)) / 86400000)
      const projectName = booking.projectName || 'your booking'
      const title = '🚨 Equipment overdue'
      const body  = `Equipment for "${projectName}" is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`
      const opts  = { title, body, url: '/booking/equipment' }

      const userSnap = await db.collection('users').doc(booking.studentId).get()
      const tokens: string[] = (await tokensFor([userSnap.id])) as string[]

      await Promise.all([
        sendPush(tokens, { ...opts, tag: `equipment-overdue-${bookingDoc.id}` }),
        saveNotifications([booking.studentId], opts),
      ])
    }
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// sendEventInviteNotifications — callable: push "invited" / "canceled" to the
// people on one of the caller's own events.
//
// Everything comes from the event doc, never from the request: recipients
// must be on the event, and title/organiser/time are the event's own. Each
// person is told once — notifiedIds records who has been invited, and a
// cancel removes them again — so the call can't be looped to spam anyone.
// For a deleted event, call with canceled: true BEFORE deleting it.
// ─────────────────────────────────────────────────────────────────────────────

function eventWhen(ev: FirebaseFirestore.DocumentData): { dateStr: string; timeStr: string } {
  const start: Date | null = ev.startTime?.toDate?.() ?? null
  if (!start) return { dateStr: '', timeStr: '' }
  const tz = 'Europe/Stockholm'
  return {
    dateStr: start.toLocaleDateString('sv-SE', { timeZone: tz }),
    timeStr: ev.allDay ? 'All day' : start.toLocaleTimeString('sv-SE', { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
  }
}

export const sendEventInviteNotifications = functions.region(REGION).runWith(LIMITS).https.onCall(async (data, context) => {
  const uid = await requireMember(context)
  await requireAllowed(uid, 'event-invite', 20)

  const eventId: string = data?.eventId ?? ''
  if (!eventId) throw new functions.https.HttpsError('invalid-argument', 'eventId is required')
  const eventRef = db.collection('personal_events').doc(eventId)
  const canceled = data?.canceled === true
  const requested = new Set<string>(Array.isArray(data?.inviteeIds) ? data.inviteeIds.slice(0, 50) : [])

  // Decide recipients and record them atomically, so parallel calls can't double-send
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(eventRef)
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
    const ev = snap.data()!
    if (ev.userId !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'You can only send notifications for events you created')
    }
    const invitees: string[] = ev.inviteeIds ?? []
    const notified: string[] = ev.notifiedIds ?? []
    const recipients = canceled
      // Only people who were actually told about it (older events: anyone listed)
      ? [...requested].filter(id => notified.includes(id) || (!ev.notifiedIds && invitees.includes(id)))
      : [...requested].filter(id => invitees.includes(id) && !notified.includes(id))
    if (recipients.length) {
      tx.update(eventRef, {
        notifiedIds: canceled
          ? admin.firestore.FieldValue.arrayRemove(...recipients)
          : admin.firestore.FieldValue.arrayUnion(...recipients),
      })
    }
    return { recipients, ev }
  })
  if (!result.recipients.length) return { sent: 0 }

  const ev = result.ev
  const organizerName = String(ev.organizerName ?? 'Someone')
  const title = String(ev.title ?? 'Meeting')
  const { dateStr, timeStr } = eventWhen(ev)
  const locationPart = ev.location ? ` · ${ev.location}` : ''

  const tokens = await tokensFor(result.recipients)
  if (!tokens.length) return { sent: 0 }
  await sendPush(tokens, {
    title: canceled ? `❌ ${organizerName} canceled: "${title}"` : `📅 ${organizerName} invited you: "${title}"`,
    body:  canceled ? '' : `${dateStr} at ${timeStr}${locationPart}`,
    url:   '/calendar',
    tag:   `event-invite-${eventId}`,
  })
  return { sent: tokens.length }
})

// ─────────────────────────────────────────────────────────────────────────────
// sendEventReminders — push notification about 15 min before calendar events.
// Runs every 5 minutes over a 10–20 min window: the windows overlap, so a late
// or skipped run doesn't lose a reminder, and claimOnce makes sure each event
// start is announced once. A moved event (new start time) is announced again.
// ─────────────────────────────────────────────────────────────────────────────

export function reminderWindow(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() + 10 * 60_000), to: new Date(now.getTime() + 20 * 60_000) }
}

export function reminderText(title: string, start: Date, place?: string | null): { title: string; body: string } {
  return { title: `Upcoming: ${title}`, body: `Starts at ${stockholmTime(start)}${place ? ` · ${place}` : ''}` }
}

export async function runEventReminders(now = new Date()) {
  const { from, to } = reminderWindow(now)
  const fromTs = admin.firestore.Timestamp.fromDate(from)
  const toTs   = admin.firestore.Timestamp.fromDate(to)
  let sent = 0

  // ── Lesson events ──────────────────────────────────────────────────────────
  const lessonsSnap = await db.collection('lessons')
    .where('startTime', '>=', fromTs)
    .where('startTime', '<=', toTs)
    .get()

  for (const lessonDoc of lessonsSnap.docs) {
    const lesson = lessonDoc.data()
    const start: Date = (lesson.startTime as admin.firestore.Timestamp).toDate()
    if (!(await claimOnce(`reminder__lesson__${lessonDoc.id}__${start.getTime()}`))) continue
    const { title, body } = reminderText(lesson.title ?? 'Lesson', start, lesson.classroom)

    const recipients: string[] = []
    // All students in this cohort
    if (lesson.cohortId) {
      const studentsSnap = await db.collection('users')
        .where('cohortId', '==', lesson.cohortId)
        .where('isActive', '==', true)
        .get()
      recipients.push(...studentsSnap.docs.map(d => d.id))
    }
    // The teacher(s) on this lesson
    recipients.push(...(lesson.teacherIds ?? []), ...(lesson.teacherId ? [lesson.teacherId] : []))

    const tokens = await tokensFor([...new Set(recipients.filter(Boolean))])
    await sendFcmToTokens(tokens, title, body)
    sent++
  }

  // ── Personal events ────────────────────────────────────────────────────────
  const personalSnap = await db.collection('personal_events')
    .where('startTime', '>=', fromTs)
    .where('startTime', '<=', toTs)
    .get()

  for (const evDoc of personalSnap.docs) {
    const ev = evDoc.data()
    const start: Date = (ev.startTime as admin.firestore.Timestamp).toDate()
    if (!(await claimOnce(`reminder__personal__${evDoc.id}__${start.getTime()}`))) continue
    const { title, body } = reminderText(ev.title ?? 'Personal event', start, ev.location)
    const tokens = await tokensFor([...new Set([ev.userId, ...(ev.inviteeIds ?? [])].filter(Boolean))] as string[])
    await sendFcmToTokens(tokens, title, body)
    sent++
  }
  return { sent }
}

export const sendEventReminders = functions.region(REGION).runWith(LIMITS).pubsub
  .schedule('every 5 minutes')
  .onRun(async () => { await runEventReminders() })

// ─────────────────────────────────────────────────────────────────────────────
// dailyTeacherSummary — Mon–Fri 08:00 morning briefing push to teachers/admins
// ─────────────────────────────────────────────────────────────────────────────

export const dailyTeacherSummary = functions.region(REGION).runWith(LIMITS).pubsub
  .schedule('0 8 * * 1-5')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const today    = new Date()
    // Today's lessons in Swedish time, midnight to midnight
    const { start: dayStart, end: tomorrow } = stockholmDayBounds(today)
    const todayStr = stockholmDate(today)
    if (!(await claimOnce(`teacher-summary__${todayStr}`))) return null   // once a day, even on a retry

    const [lessonsSnap, equipmentSnap, absenceSnap, overdueSnap] = await Promise.all([
      db.collection('lessons')
        .where('startTime', '>=', admin.firestore.Timestamp.fromDate(dayStart))
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

    const dateLabel = new Intl.DateTimeFormat('en-SE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' }).format(today)
    await pushToTeachersAndAdmins(
      `☀️ Good morning — ${dateLabel}`,
      parts.join(' · '),
      '/teacher',
    )
    return null
  })
