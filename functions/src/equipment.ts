import { functions, db } from './lib'
import { sendPush, pushToTeachersAndAdmins } from './notifications-core'

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
      await sendPush(tokens, {
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
        await sendPush(tokens, {
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
        await sendPush(tokens, {
          title: '🚫 Booking rejected',
          body: `"${equip.name}" is not available for your class`,
          url: '/booking/equipment',
          tag: 'equipment-booking',
        })
        return null
      }
    }

    await pushToTeachersAndAdmins(
      '📦 Equipment booking request',
      `${booking.studentName} requested equipment for "${booking.projectName}"`,
      '/teacher/equipment-requests',
    )
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
    const studentSnap = await db.collection('users').doc(after.studentId as string).get()
    const tokens: string[] = studentSnap.data()?.fcmTokens ?? []
    if (after.status === 'confirmed') {
      await sendPush(tokens, {
        title: '✅ Equipment booking confirmed',
        body:  `Your equipment for "${after.projectName}" has been confirmed`,
        url:   '/booking/equipment',
        tag:   'equipment-booking',
      })
    } else if (after.status === 'checked-out') {
      await sendPush(tokens, {
        title: '📦 Equipment checked out',
        body:  `Equipment for "${after.projectName}" has been handed over — remember to return it on time`,
        url:   '/booking/equipment',
        tag:   'equipment-booking',
      })
    } else if (after.status === 'returned') {
      await sendPush(tokens, {
        title: '✅ Equipment returned',
        body:  `Your equipment for "${after.projectName}" has been marked as returned`,
        url:   '/booking/equipment',
        tag:   'equipment-booking',
      })
    } else if (after.status === 'cancelled') {
      await sendPush(tokens, {
        title: '❌ Equipment booking cancelled',
        body:  `Your equipment request for "${after.projectName}" was not approved`,
        url:   '/booking/equipment',
        tag:   'equipment-booking',
      })
    }
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onInventoryProjectUpdated — notify borrowers when project status changes
// ─────────────────────────────────────────────────────────────────────────────

export const onInventoryProjectUpdated = functions.firestore
  .document('inventory_projects/{projectId}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (before.status === after.status) return null
    if (after.status !== 'returned') return null
    const borrowerIds: string[] = after.borrowerIds ?? []
    for (const uid of borrowerIds) {
      const userSnap = await db.collection('users').doc(uid).get()
      const tokens: string[] = userSnap.data()?.fcmTokens ?? []
      if (tokens.length === 0) continue
      await sendPush(tokens, {
        title: '✅ Equipment returned',
        body:  `Project "${after.name}" has been marked as returned`,
        url:   '/booking/equipment',
        tag:   'inventory',
      })
    }
    return null
  })
