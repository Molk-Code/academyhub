import { functions, db } from './lib'
import { sendPush, saveNotifications, pushToAdmins } from './notifications-core'

async function pushAndSave(studentId: string, tokens: string[], opts: { title: string; body: string; url: string; tag: string }) {
  await Promise.all([
    sendPush(tokens, opts),
    saveNotifications([studentId], opts),
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// onEquipmentBookingCreated — notify teachers/admins of new equipment requests
// ─────────────────────────────────────────────────────────────────────────────

export const onEquipmentBookingCreated = functions.firestore
  .document('equipment_bookings/{bookingId}')
  .onCreate(async (snap) => {
    const booking = snap.data()

    // Rate limit: max 5 pending bookings per student
    const pendingSnap = await db.collection('equipment_bookings')
      .where('studentId', '==', booking.studentId)
      .where('status', '==', 'pending')
      .get()
    if (pendingSnap.size >= 5) {
      // Notify the student before deleting so they know why it was rejected
      const studentSnap = await db.collection('users').doc(booking.studentId as string).get()
      const tokens: string[] = studentSnap.data()?.fcmTokens ?? []
      await pushAndSave(booking.studentId as string, tokens, {
        title: '⚠️ Equipment booking limit reached',
        body: 'You already have 5 pending requests. Cancel or wait for one to be confirmed before adding more.',
        url: '/booking/equipment',
        tag: 'equipment-booking',
      })
      await snap.ref.delete()
      return null
    }

    // Enforce equipment access restrictions (filmYear2Only / allowedCohortIds)
    const studentSnap2 = await db.collection('users').doc(booking.studentId as string).get()
    const studentData = studentSnap2.data()
    const items: { equipmentId: string }[] = booking.items ?? []
    for (const item of items) {
      if (!item.equipmentId) continue
      const equipSnap = await db.collection('equipment').doc(item.equipmentId).get()
      if (!equipSnap.exists) continue
      const equip = equipSnap.data()!
      const cohortSnap = studentData?.cohortId
        ? await db.collection('cohorts').doc(studentData.cohortId).get()
        : null
      const programYear: number = cohortSnap?.data()?.programYear ?? 1
      if (equip.filmYear2Only && programYear !== 2) {
        await snap.ref.delete()
        const tokens: string[] = studentData?.fcmTokens ?? []
        await pushAndSave(booking.studentId as string, tokens, {
          title: '🚫 Booking rejected',
          body: `"${equip.name}" is only available to Year 2 students`,
          url: '/booking/equipment',
          tag: 'equipment-booking',
        })
        return null
      }
      if (equip.allowedCohortIds?.length > 0 && studentData?.cohortId && !equip.allowedCohortIds.includes(studentData.cohortId)) {
        await snap.ref.delete()
        const tokens: string[] = studentData?.fcmTokens ?? []
        await pushAndSave(booking.studentId as string, tokens, {
          title: '🚫 Booking rejected',
          body: `"${equip.name}" is not available for your class`,
          url: '/booking/equipment',
          tag: 'equipment-booking',
        })
        return null
      }
    }

    await pushToAdmins(
      '📦 Equipment booking request',
      `${booking.studentName} requested equipment for "${booking.projectName}"`,
      '/admin/equipment',
    )
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onEquipmentBookingMessageCreated — notify the other side of a reply
// ─────────────────────────────────────────────────────────────────────────────

export const onEquipmentBookingMessageCreated = functions.firestore
  .document('equipment_bookings/{bookingId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const message = snap.data()
    const bookingSnap = await db.collection('equipment_bookings').doc(context.params.bookingId).get()
    if (!bookingSnap.exists) return null
    const booking = bookingSnap.data()!

    if (message.senderRole === 'student') {
      await pushToAdmins(
        '💬 New message on a booking',
        `${message.senderName} — "${booking.projectName}": ${message.text}`,
        '/admin/equipment',
      )
    } else {
      const studentSnap = await db.collection('users').doc(booking.studentId as string).get()
      const tokens: string[] = studentSnap.data()?.fcmTokens ?? []
      const opts = {
        title: '💬 New message on your booking',
        body:  `"${booking.projectName}": ${message.text}`,
        url:   '/my-bookings',
      }
      await Promise.all([
        sendPush(tokens, { ...opts, tag: 'equipment-booking' }),
        saveNotifications([booking.studentId as string], opts),
      ])
    }
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onEquipmentBookingUpdated — notify student when booking status changes
// ─────────────────────────────────────────────────────────────────────────────

export const onEquipmentBookingUpdated = functions.firestore
  .document('equipment_bookings/{bookingId}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (before.status === after.status) return null
    // Closed because its inventory project was archived — the project's own
    // notifications already covered it
    if (after.closedByProject && !before.closedByProject) return null
    const studentId = after.studentId as string
    const studentSnap = await db.collection('users').doc(studentId).get()
    const tokens: string[] = studentSnap.data()?.fcmTokens ?? []

    let opts: { title: string; body: string; url: string } | null = null
    if (after.status === 'confirmed') {
      opts = {
        title: '✅ Equipment booking confirmed',
        body:  after.teacherNotes
          ? `Your equipment for "${after.projectName}" has been confirmed: ${after.teacherNotes}`
          : `Your equipment for "${after.projectName}" has been confirmed`,
        url:   '/my-bookings',
      }
    } else if (after.status === 'checked-out') {
      opts = {
        title: '📦 Equipment checked out',
        body:  `Equipment for "${after.projectName}" has been handed over — remember to return it on time`,
        url:   '/my-bookings',
      }
    } else if (after.status === 'returned') {
      opts = {
        title: '✅ Equipment returned',
        body:  `Your equipment for "${after.projectName}" has been marked as returned`,
        url:   '/my-bookings',
      }
    } else if (after.status === 'denied') {
      opts = {
        title: '❌ Equipment booking denied',
        body:  after.teacherNotes
          ? `Your equipment request for "${after.projectName}" was denied: ${after.teacherNotes}`
          : `Your equipment request for "${after.projectName}" was denied`,
        url:   '/my-bookings',
      }
    } else if (after.status === 'cancelled') {
      opts = {
        title: '🗑️ Equipment booking cancelled',
        body:  `Your equipment request for "${after.projectName}" was cancelled`,
        url:   '/my-bookings',
      }
    }
    if (!opts) return null

    await Promise.all([
      sendPush(tokens, { ...opts, tag: 'equipment-booking' }),
      saveNotifications([studentId], opts),
    ])
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onInventoryProjectCreated — notify borrowers when a project is set up for them
// ─────────────────────────────────────────────────────────────────────────────

export const onInventoryProjectCreated = functions.firestore
  .document('inventory_projects/{projectId}')
  .onCreate(async (snap) => {
    const project = snap.data()
    const borrowerIds: string[] = project.borrowerIds ?? []
    if (borrowerIds.length === 0) return null
    const usersSnaps = await Promise.all(borrowerIds.map(uid => db.collection('users').doc(uid).get()))
    const tokens = usersSnaps.flatMap(s => (s.data()?.fcmTokens ?? []) as string[])
    const opts = {
      title: '📦 Equipment project created',
      body:  `"${project.name}" — return by ${project.returnDate}`,
      url:   '/my-bookings',
    }
    await Promise.all([
      sendPush(tokens, { ...opts, tag: 'inventory' }),
      saveNotifications(borrowerIds, opts),
    ])
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onInventoryProjectUpdated — keep the student's original booking request in
// step with the project, and notify borrowers of returns and new dates
// ─────────────────────────────────────────────────────────────────────────────

export const onInventoryProjectUpdated = functions.firestore
  .document('inventory_projects/{projectId}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()

    // The booking request feeds the dashboard and Rental House "My bookings":
    // mirror date changes, and close it once the project is archived/returned
    const bookingId = after.bookingId as string | undefined
    if (bookingId) {
      const update: Record<string, unknown> = {}
      if (before.checkoutDate !== after.checkoutDate) update.checkoutDate = after.checkoutDate ?? ''
      if (before.returnDate   !== after.returnDate)   update.returnDate   = after.returnDate ?? ''
      if (before.status !== after.status && (after.status === 'archived' || after.status === 'returned')) {
        update.status = 'returned'
        update.closedByProject = true
      }
      if (Object.keys(update).length > 0) {
        try { await db.collection('equipment_bookings').doc(bookingId).update(update) }
        catch (err) { console.warn('[inventory] could not sync booking', bookingId, err) }
      }
    }

    const borrowerIds: string[] = after.borrowerIds ?? []
    if (borrowerIds.length === 0) return null
    let opts: { title: string; body: string; url: string } | null = null
    if (before.status !== after.status && after.status === 'returned') {
      opts = {
        title: '✅ Equipment returned',
        body:  `Project "${after.name}" has been marked as returned`,
        url:   '/my-bookings',
      }
    } else if (before.returnDate !== after.returnDate && after.returnDate && after.status !== 'archived') {
      opts = {
        title: '📅 Return date changed',
        body:  `"${after.name}" — now return by ${after.returnDate}`,
        url:   '/my-bookings',
      }
    }
    if (!opts) return null
    const usersSnaps = await Promise.all(borrowerIds.map(uid => db.collection('users').doc(uid).get()))
    const tokens = usersSnaps.flatMap(s => (s.data()?.fcmTokens ?? []) as string[])
    await Promise.all([
      sendPush(tokens, { ...opts, tag: 'inventory' }),
      saveNotifications(borrowerIds, opts),
    ])
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onInventoryItemWritten — keep each catalog item's "available" count equal to
// its total minus the units out in projects (checked out, damaged or missing).
// Recomputed from the items rather than incremented, so the count can't drift.
// Items with no equipmentId (typed by hand or unknown codes) never count.
// ─────────────────────────────────────────────────────────────────────────────

const OUT_STATUSES = ['checked-out', 'damaged', 'missing']

export async function recomputeEquipmentAvailable(equipmentId: string): Promise<void> {
  const equipRef = db.collection('equipment').doc(equipmentId)
  const [equipSnap, itemsSnap] = await Promise.all([
    equipRef.get(),
    db.collectionGroup('items').where('equipmentId', '==', equipmentId).get(),
  ])
  if (!equipSnap.exists) return
  const out = itemsSnap.docs.filter(d =>
    d.ref.parent.parent?.parent.id === 'inventory_projects' && OUT_STATUSES.includes(d.data().status),
  ).length
  const total = Number(equipSnap.data()?.totalQuantity ?? 0)
  const available = Math.max(0, total - out)
  if (equipSnap.data()?.available !== available) await equipRef.update({ available })
}

export const onInventoryItemWritten = functions.firestore
  .document('inventory_projects/{projectId}/items/{itemId}')
  .onWrite(async (change) => {
    const before = change.before.exists ? change.before.data() : undefined
    const after  = change.after.exists ? change.after.data() : undefined
    const wasOut = !!before && OUT_STATUSES.includes(before.status)
    const isOut  = !!after && OUT_STATUSES.includes(after.status)
    if (wasOut === isOut && before?.equipmentId === after?.equipmentId) return null
    const ids = new Set([before?.equipmentId, after?.equipmentId].filter((id): id is string => !!id))
    await Promise.all([...ids].map(recomputeEquipmentAvailable))
    return null
  })
