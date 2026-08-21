import { admin, functions, db, escapeHtml, getResend, getEmailConfig } from './lib'
import { sendPush, saveNotifications, sendFcmToTokens } from './notifications'
import { checkLevelUp } from './points'

// ─────────────────────────────────────────────────────────────────────────────
// checkInAttendance — validate rotating QR token and record student presence
// ─────────────────────────────────────────────────────────────────────────────

export const checkInAttendance = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { token } = data as { token: string }
  if (!token || typeof token !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'token is required.')
  }

  const uid = context.auth.uid

  try {
    const sessionSnap = await db.collection('attendance_sessions')
      .where('token', '==', token)
      .limit(1)
      .get()

    if (sessionSnap.empty) {
      throw new functions.https.HttpsError('not-found', 'Invalid QR code. Ask your teacher to refresh it.')
    }

    const sessionDoc = sessionSnap.docs[0]
    const session    = sessionDoc.data()

    if (!session.isActive) {
      throw new functions.https.HttpsError('failed-precondition', 'This attendance session is no longer active.')
    }

    const now     = admin.firestore.Timestamp.now()
    const expired = session.expiresAt.toMillis() < now.toMillis()

    if (expired) {
      throw new functions.https.HttpsError('deadline-exceeded', 'QR code expired. Ask your teacher to refresh it.')
    }

    const lessonId      = session.lessonId as string
    const attendanceRef = db.collection('lessons').doc(lessonId).collection('attendance').doc(uid)

    const existing = await attendanceRef.get()

    if (existing.exists) {
      throw new functions.https.HttpsError('already-exists', 'You have already checked in to this lesson.')
    }

    const [userSnap, settingsSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('settings').doc('attendance').get(),
    ])

    const displayName     = userSnap.exists ? (userSnap.data()?.displayName ?? 'Student') : 'Student'
    const pointsPerCheckIn: number = settingsSnap.exists ? (settingsSnap.data()?.pointsPerCheckIn ?? 0) : 0

    await attendanceRef.set({
      studentId:     uid,
      displayName,
      checkedInAt:   admin.firestore.FieldValue.serverTimestamp(),
      sessionId:     sessionDoc.id,
      pointsAwarded: pointsPerCheckIn,
    })

    if (pointsPerCheckIn > 0) {
      await db.runTransaction(async (tx) => {
        const logRef = db.collection('points_log').doc()
        tx.set(logRef, {
          studentId:   uid,
          points:      pointsPerCheckIn,
          reason:      'attendance',
          referenceId: attendanceRef.id,
          awardedBy:   null,
          createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        })
        tx.update(db.collection('users').doc(uid), {
          totalPoints: admin.firestore.FieldValue.increment(pointsPerCheckIn),
        })
      })
      const newTotal = ((await db.collection('users').doc(uid).get()).data()?.totalPoints ?? 0) as number
      await checkLevelUp(uid, newTotal)
    }

    return { success: true, lessonId, pointsAwarded: pointsPerCheckIn }

  } catch (err: any) {
    console.error('checkInAttendance error:', err?.code, err?.message)
    if (err instanceof functions.https.HttpsError) throw err
    throw new functions.https.HttpsError('internal', err?.message ?? 'Unknown error')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// onBookingConfirmed — push to the student who made the booking
// ─────────────────────────────────────────────────────────────────────────────

export const onBookingConfirmed = functions.firestore
  .document('room_bookings/{id}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (!after) return null

    // Only fire when status actually changes to a terminal state
    if (before?.status === after.status) return null
    if (after.status !== 'confirmed' && after.status !== 'denied') return null

    // Atomic idempotency guard — prevents duplicate pushes if Firestore retries
    const alreadySent = await db.runTransaction(async tx => {
      const fresh = await tx.get(change.after.ref)
      if (fresh.data()?.pushSent === true) return true
      tx.update(change.after.ref, { pushSent: true })
      return false
    })
    if (alreadySent) return null

    const uid: string = after.studentId ?? after.userId
    if (!uid) return null

    const userSnap = await db.collection('users').doc(uid).get()
    const tokens: string[] = userSnap.data()?.fcmTokens ?? []

    const bookingOpts = after.status === 'confirmed'
      ? { title: '✅ Room booking confirmed', body: `Your booking for ${after.roomName ?? 'the room'} has been confirmed.`, url: '/booking' }
      : { title: '❌ Room booking denied',    body: `Your booking for ${after.roomName ?? 'the room'} was not approved.`,  url: '/booking' }
    await Promise.all([
      sendPush(tokens, { ...bookingOpts, tag: 'booking-update' }),
      saveNotifications([uid], bookingOpts),
    ])
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onSemesterEventStart — daily push to teachers/admins for events starting today
// ─────────────────────────────────────────────────────────────────────────────

export const onSemesterEventStart = functions.pubsub
  .schedule('0 8 * * *')
  .timeZone('Europe/Stockholm')
  .onRun(async () => {
    const now   = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day   = String(now.getDate()).padStart(2, '0')
    const todayMmDd = `${month}-${day}`

    // Find active semester events starting today
    const eventsSnap = await db.collection('semester_events')
      .where('startDate', '==', todayMmDd)
      .where('isActive', '==', true)
      .get()

    if (eventsSnap.empty) return

    // Collect FCM tokens for all teachers and admins
    const usersSnap = await db.collection('users')
      .where('isActive', '==', true)
      .get()

    const tokens: string[] = []
    for (const uDoc of usersSnap.docs) {
      const u = uDoc.data()
      const roles: string[] = u.roles ?? []
      if (roles.includes('teacher') || roles.includes('admin') || u.role === 'teacher' || u.role === 'admin') {
        const fcm: string[] = u.fcmTokens ?? []
        tokens.push(...fcm)
      }
    }

    for (const evDoc of eventsSnap.docs) {
      const ev = evDoc.data()
      await sendFcmToTokens(
        tokens,
        ev.title ?? 'Semester Event',
        ev.description || `Starting today — ${todayMmDd}`,
      )
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// receiveOfficeCalendarEvent — HTTP webhook for Power Automate → Office 365
// calendar sync. One sync config (office_calendar_syncs/{syncId}) per external
// Outlook calendar; each carries its own shared secret and target cohortId.
// No Firebase Auth involved — Power Automate authenticates with a header secret.
// ─────────────────────────────────────────────────────────────────────────────

interface OfficeSyncPayload {
  externalId:  string            // Outlook event Id from the Graph trigger
  subject?:    string
  start?:      string            // ISO datetime
  end?:        string            // ISO datetime
  location?:   string
  isAllDay?:   boolean | string  // Power Automate often sends "True"/"False" as text
  changeType?: string
}

// Power Automate's raw-JSON body editor frequently stringifies non-string dynamic
// content (booleans included), so accept either shape here.
function toBool(v: boolean | string | undefined): boolean {
  if (typeof v === 'boolean') return v
  return String(v ?? '').toLowerCase() === 'true'
}

export const receiveOfficeCalendarEvent = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
    return
  }

  const syncId = String(req.query.syncId ?? '')
  if (!syncId) {
    res.status(400).json({ error: 'Missing ?syncId=... in the webhook URL.' })
    return
  }

  const syncSnap = await db.collection('office_calendar_syncs').doc(syncId).get()
  if (!syncSnap.exists) {
    res.status(404).json({ error: 'Unknown syncId.' })
    return
  }
  const sync = syncSnap.data()!

  const providedSecret = req.get('x-webhook-secret') ?? ''
  if (!sync.webhookSecret || providedSecret !== sync.webhookSecret) {
    res.status(401).json({ error: 'Invalid or missing x-webhook-secret header.' })
    return
  }

  if (sync.enabled === false) {
    // Toggled off in the app — accept the call so the Power Automate run
    // still shows "succeeded", but don't write anything.
    res.status(200).json({ ok: true, skipped: true, reason: 'sync is disabled' })
    return
  }

  const body = (req.body ?? {}) as OfficeSyncPayload

  // Log full payload so we can see exactly what Power Automate sends
  console.log('[officeSync] raw body:', JSON.stringify({
    externalId:  body.externalId,
    subject:     body.subject,
    start:       body.start,
    end:         body.end,
    isAllDay:    body.isAllDay,
    changeType:  body.changeType,
    location:    body.location,
    syncId,
    allKeys: Object.keys(req.body ?? {}),
  }))

  if (!body.externalId) {
    res.status(400).json({ error: 'externalId is required.' })
    return
  }

  const docId = `${syncId}_${body.externalId}`
  const eventRef = db.collection('synced_events').doc(docId)

  try {
    const DELETE_MARKERS = [
      'deleted', 'delete', 'removed',
      'togs bort', 'borttagen', 'raderad',
      'cancelled', 'canceled',
    ]
    const changeTypeLc = (body.changeType ?? '').toLowerCase()
    const isDelete = DELETE_MARKERS.some(m => changeTypeLc.includes(m)) || !body.subject

    console.log('[officeSync] action:', isDelete ? 'DELETE' : 'UPSERT',
      '| changeType:', body.changeType, '| docId:', docId)

    if (isDelete) {
      await eventRef.delete()
      // Safety net: delete any stale docs for this syncId with the same externalId
      // (scoped to syncId so duplicated shared events in other calendars are not affected)
      const staleSnap = await db.collection('synced_events')
        .where('syncId', '==', syncId)
        .where('externalId', '==', body.externalId)
        .get()
      if (!staleSnap.empty) {
        const batch = db.batch()
        staleSnap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
        console.log('[officeSync] deleted', staleSnap.size, 'stale doc(s) with externalId', body.externalId)
      }
    } else {
      const startDate = body.start ? new Date(body.start) : null
      const endDate   = body.end   ? new Date(body.end)   : null
      if (!startDate || isNaN(startDate.getTime())) {
        res.status(400).json({ error: 'start is required and must be a valid ISO datetime.' })
        return
      }
      const allDay = toBool(body.isAllDay)
      console.log('[officeSync] allDay resolved:', allDay, '(raw:', body.isAllDay, ')')
      await eventRef.set({
        syncId,
        cohortId:   sync.cohortId ?? 'all',
        externalId: body.externalId,
        title:      body.subject,
        startTime:  admin.firestore.Timestamp.fromDate(startDate),
        endTime:    endDate && !isNaN(endDate.getTime()) ? admin.firestore.Timestamp.fromDate(endDate) : null,
        allDay,
        location:   body.location || null,
        source:     'office365',
        updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })

      // Deduplicate: if Outlook changed the externalId (e.g. event moved between calendars),
      // stale docs with the same syncId + title + startTime will remain. Delete them.
      const staleByTitle = await db.collection('synced_events')
        .where('syncId', '==', syncId)
        .where('startTime', '==', admin.firestore.Timestamp.fromDate(startDate))
        .get()
      const newTitleNorm = (body.subject ?? '').trim().toLowerCase()
      const staleDocs = staleByTitle.docs.filter(d =>
        d.id !== docId && d.data().title?.trim?.().toLowerCase() === newTitleNorm,
      )
      if (staleDocs.length > 0) {
        const batch = db.batch()
        staleDocs.forEach(d => batch.delete(d.ref))
        await batch.commit()
        console.log('[officeSync] deduped', staleDocs.length, 'stale doc(s) for', body.subject, startDate.toISOString())
      }
    }

    await syncSnap.ref.update({
      lastReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
      eventCount:     admin.firestore.FieldValue.increment(1),
    })

    res.status(200).json({ ok: true })
  } catch (err: any) {
    console.error('receiveOfficeCalendarEvent failed', err)
    res.status(500).json({ error: err?.message ?? 'Unknown error' })
  }
})

// ── sendGuestTeacherBookingEmail ──────────────────────────────────────────────
export const sendGuestTeacherBookingEmail = functions.runWith({ secrets: ['RESEND_API_KEY'] }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')

  const { guestTeacherId, lessonId } = data as { guestTeacherId: string; lessonId: string }

  const [guestSnap, lessonSnap] = await Promise.all([
    db.collection('guest_teachers').doc(guestTeacherId).get(),
    db.collection('lessons').doc(lessonId).get(),
  ])

  if (!guestSnap.exists) throw new functions.https.HttpsError('not-found', 'Guest teacher not found.')
  if (!lessonSnap.exists) throw new functions.https.HttpsError('not-found', 'Lesson not found.')

  const guest  = guestSnap.data() as any
  const lesson = lessonSnap.data() as any

  if (!guest.email) throw new functions.https.HttpsError('failed-precondition', 'No email assigned to this guest teacher.')

  let subjectTitle = ''
  if (lesson.subjectId) {
    const subSnap = await db.collection('subjects').doc(lesson.subjectId).get()
    if (subSnap.exists) subjectTitle = (subSnap.data() as any).title ?? ''
  }

  const emailCfg  = await getEmailConfig()
  const fromName  = emailCfg?.fromName  || 'CineForge'
  const fromEmail = emailCfg?.fromEmail || 'onboarding@resend.dev'

  function fmtDate(d: Date) {
    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
  }
  function fmtTime(d: Date) {
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  const startDate = lesson.startTime?.toDate?.()
  const endDate   = lesson.endTime?.toDate?.()
  const dateStr   = startDate ? fmtDate(startDate) : 'TBD'
  const timeStr   = startDate ? fmtTime(startDate) + (endDate ? `–${fmtTime(endDate)}` : '') : 'TBD'
  const location  = lesson.isOnline ? (lesson.classroom || 'Online') : (lesson.classroom || 'TBD')

  const row = (label: string, value: string) =>
    `<tr><td style="padding:10px 16px;font-weight:600;color:#888;width:110px;border-top:1px solid #eee;">${label}</td><td style="padding:10px 16px;border-top:1px solid #eee;">${escapeHtml(value)}</td></tr>`

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
      <h2 style="color:#1a1a1a;margin-bottom:8px;">Booking Confirmation</h2>
      <p style="color:#555;margin-bottom:24px;">Hi ${escapeHtml(guest.name)}, you have been booked for the following lesson:</p>
      <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:10px 16px;font-weight:600;color:#888;width:110px;">Lesson</td><td style="padding:10px 16px;">${escapeHtml(lesson.title)}</td></tr>
        ${subjectTitle ? row('Subject', subjectTitle) : ''}
        ${row('Date', dateStr)}
        ${row('Time', timeStr)}
        ${row('Location', location)}
      </table>
      <p style="color:#aaa;font-size:12px;margin-top:24px;">Sent via ${escapeHtml(fromName)}</p>
    </div>
  `

  await getResend().emails.send({
    from:    `${fromName} <${fromEmail}>`,
    to:      [guest.email],
    subject: `Booking confirmation: ${lesson.title}`,
    html,
  })

  return { ok: true }
})
