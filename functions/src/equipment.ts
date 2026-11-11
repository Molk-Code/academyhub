import { functions, db, admin, requireTeacherOrAdmin, LIMITS, allow, REGION } from './lib'
import { sendPush, saveNotifications, tokensFor } from './notifications-core'

// ─────────────────────────────────────────────────────────────────────────────
// Booking parts — each catalog category of a booking is accepted or denied by
// the staff who handle that category (settings/equipment.responsibility:
// uid → 'all' | 'none' | category names; unset = all). Mirrors src/lib/bookingParts.ts.
// ─────────────────────────────────────────────────────────────────────────────

const OTHER_CATEGORY = 'Other'
type Responsibility = 'all' | 'none' | string[]

function handlesCategory(r: Responsibility | undefined, category: string): boolean {
  if (r === undefined || r === 'all') return true
  if (r === 'none') return false
  return Array.isArray(r) && r.includes(category)
}

async function loadResponsibility(): Promise<Record<string, Responsibility>> {
  const snap = await db.collection('settings').doc('equipment').get()
  return (snap.data()?.responsibility as Record<string, Responsibility>) ?? {}
}

async function bookingCategories(items: { equipmentId?: string; category?: string }[]): Promise<string[]> {
  const cats = new Set<string>()
  for (const it of items) {
    if (it.category) { cats.add(it.category); continue }
    const eq = it.equipmentId ? await db.collection('equipment').doc(it.equipmentId).get() : null
    cats.add((eq?.data()?.category as string) || OTHER_CATEGORY)
  }
  return [...cats]
}

// Staff to notify about a booking touching these categories: admins and
// teachers whose responsibility covers one of them. Staff with no setting
// keep the old behaviour (admins are told about everything, teachers aren't).
// Falls back to every admin so a request never goes unseen.
async function staffForCategories(categories: string[]): Promise<{ uids: string[]; tokens: string[] }> {
  const resp = await loadResponsibility()
  const [byRole, byRoles] = await Promise.all([
    db.collection('users').where('role', 'in', ['teacher', 'admin']).get(),
    db.collection('users').where('roles', 'array-contains-any', ['teacher', 'admin']).get(),
  ])
  const seen = new Set<string>()
  const admins: FirebaseFirestore.DocumentSnapshot[] = []
  const picked: FirebaseFirestore.DocumentSnapshot[] = []
  for (const d of [...byRole.docs, ...byRoles.docs]) {
    if (seen.has(d.id)) continue
    seen.add(d.id)
    const data = d.data()
    const roles: string[] = (data.roles as string[])?.length ? data.roles : [data.role]
    const isAdmin = roles.includes('admin') || data.role === 'admin'
    if (isAdmin) admins.push(d)
    const r = resp[d.id]
    if (r === undefined ? isAdmin : categories.some(c => handlesCategory(r, c))) picked.push(d)
  }
  const list = picked.length ? picked : admins
  const uids = list.map(d => d.id)
  return { uids, tokens: await tokensFor(uids) }
}

async function pushToResponsibleStaff(categories: string[], title: string, body: string, url: string) {
  const { uids, tokens } = await staffForCategories(categories)
  await Promise.all([
    sendPush(tokens, { title, body, url, tag: 'booking' }),
    saveNotifications(uids, { title, body, url }),
  ])
}

async function pushAndSave(studentId: string, tokens: string[], opts: { title: string; body: string; url: string; tag: string }) {
  await Promise.all([
    sendPush(tokens, opts),
    saveNotifications([studentId], opts),
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// onEquipmentBookingCreated — notify teachers/admins of new equipment requests
// ─────────────────────────────────────────────────────────────────────────────

export const onEquipmentBookingCreated = functions.region(REGION).runWith(LIMITS).firestore
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
      const tokens: string[] = await tokensFor([studentSnap.id])
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
        const tokens: string[] = await tokensFor([booking.studentId as string])
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
        const tokens: string[] = await tokensFor([booking.studentId as string])
        await pushAndSave(booking.studentId as string, tokens, {
          title: '🚫 Booking rejected',
          body: `"${equip.name}" is not available for your class`,
          url: '/booking/equipment',
          tag: 'equipment-booking',
        })
        return null
      }
    }

    // Stamp each item with its catalog category so the booking's parts stay
    // stable even if an item is later moved to another category
    const stamped = await Promise.all(((booking.items ?? []) as { equipmentId?: string; category?: string }[]).map(async it => {
      if (it.category) return it
      const eq = it.equipmentId ? await db.collection('equipment').doc(it.equipmentId).get() : null
      return { ...it, category: (eq?.data()?.category as string) || OTHER_CATEGORY }
    }))
    await snap.ref.update({ items: stamped })

    const categories = [...new Set(stamped.map(i => i.category as string))]
    // Rate limit on notifying staff — a script creating these in a loop would
    // otherwise push every staff phone each time (the doc itself is kept)
    // Signed-out rental guests share one budget
    const who = (booking.studentId as string) || 'rental-guests'
    if (!(await allow(who, 'booking-notify', booking.studentId ? 5 : 10))) return null
    await pushToResponsibleStaff(
      categories,
      '📦 Equipment booking request',
      `${booking.studentName} requested equipment for "${booking.projectName}"`,
      '/admin/equipment',
    )
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onEquipmentBookingMessageCreated — notify the other side of a reply
// ─────────────────────────────────────────────────────────────────────────────

export const onEquipmentBookingMessageCreated = functions.region(REGION).runWith(LIMITS).firestore
  .document('equipment_bookings/{bookingId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const message = snap.data()
    const bookingSnap = await db.collection('equipment_bookings').doc(context.params.bookingId).get()
    if (!bookingSnap.exists) return null
    const booking = bookingSnap.data()!

    if (!(await allow(String(message.senderId ?? 'unknown'), 'booking-msg-notify', 10))) return null
    if (message.senderRole === 'student') {
      await pushToResponsibleStaff(
        await bookingCategories(booking.items ?? []),
        '💬 New message on a booking',
        `${message.senderName} — "${booking.projectName}": ${message.text}`,
        '/admin/equipment',
      )
    } else {
      const studentSnap = await db.collection('users').doc(booking.studentId as string).get()
      const tokens: string[] = await tokensFor([studentSnap.id])
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

export const onEquipmentBookingUpdated = functions.region(REGION).runWith(LIMITS).firestore
  .document('equipment_bookings/{bookingId}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (before.status === after.status) return null
    // Part-by-part decisions notify from decideEquipmentBookingParts instead
    if ((after.status === 'confirmed' || after.status === 'denied') && after.categoryDecisions) return null
    // Closed because its inventory project was archived — the project's own
    // notifications already covered it
    if (after.closedByProject && !before.closedByProject) return null
    const studentId = after.studentId as string
    const studentSnap = await db.collection('users').doc(studentId).get()
    const tokens: string[] = await tokensFor([studentSnap.id])

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

export const onInventoryProjectCreated = functions.region(REGION).runWith(LIMITS).firestore
  .document('inventory_projects/{projectId}')
  .onCreate(async (snap) => {
    const project = snap.data()
    const borrowerIds: string[] = project.borrowerIds ?? []
    if (borrowerIds.length === 0) return null
    const usersSnaps = await Promise.all(borrowerIds.map(uid => db.collection('users').doc(uid).get()))
    const tokens = await tokensFor(usersSnaps.map(s => s.id))
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

export const onInventoryProjectUpdated = functions.region(REGION).runWith(LIMITS).firestore
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
        // A booking split over several projects closes when the last one does
        const booking = (await db.collection('equipment_bookings').doc(bookingId).get()).data()
        const others = ((booking?.linkedProjectIds as string[]) ?? []).filter(id => id !== change.after.id)
        const otherSnaps = await Promise.all(others.map(id => db.collection('inventory_projects').doc(id).get()))
        if (otherSnaps.every(o => !o.exists || ['archived', 'returned'].includes(o.data()?.status))) {
          update.status = 'returned'
          update.closedByProject = true
        }
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
    const tokens = await tokensFor(usersSnaps.map(s => s.id))
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

// Read and write in one transaction: when many units are scanned at once,
// each recount retries if another scan changed the items meanwhile, so the
// last write can't be based on a stale count.
export async function recomputeEquipmentAvailable(equipmentId: string): Promise<void> {
  const equipRef = db.collection('equipment').doc(equipmentId)
  await db.runTransaction(async tx => {
    const [equipSnap, itemsSnap] = await Promise.all([
      tx.get(equipRef),
      tx.get(db.collectionGroup('items').where('equipmentId', '==', equipmentId)),
    ])
    if (!equipSnap.exists) return
    const out = itemsSnap.docs.filter(d =>
      d.ref.parent.parent?.parent.id === 'inventory_projects' && OUT_STATUSES.includes(d.data().status),
    ).length
    const total = Number(equipSnap.data()?.totalQuantity ?? 0)
    const available = Math.max(0, total - out)
    if (equipSnap.data()?.available !== available) tx.update(equipRef, { available })
  })
}

export const onInventoryItemWritten = functions.region(REGION).runWith(LIMITS).firestore
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

// ─────────────────────────────────────────────────────────────────────────────
// decideEquipmentBookingParts — accept, deny or reopen the caller's parts of a
// booking. Only staff responsible for a category can decide it. The booking's
// overall status follows the parts: pending while any is undecided, then
// denied if every part was denied, otherwise confirmed.
// ─────────────────────────────────────────────────────────────────────────────

export const decideEquipmentBookingParts = functions.region(REGION).runWith(LIMITS).https.onCall(async (data, context) => {
  requireTeacherOrAdmin(context)
  const { bookingId, categories, decision, note } = data as {
    bookingId?: string; categories?: string[]; decision?: string; note?: string
  }
  if (!bookingId || typeof bookingId !== 'string') throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.')
  if (!Array.isArray(categories) || categories.length === 0 || !categories.every(c => typeof c === 'string')) {
    throw new functions.https.HttpsError('invalid-argument', 'categories is required.')
  }
  if (!['confirmed', 'denied', 'pending'].includes(decision as string)) {
    throw new functions.https.HttpsError('invalid-argument', 'decision must be confirmed, denied or pending.')
  }
  const uid = context.auth!.uid
  const resp = (await loadResponsibility())[uid]
  const notAllowed = categories.filter(c => !handlesCategory(resp, c))
  if (notAllowed.length) {
    throw new functions.https.HttpsError('permission-denied', `You don't handle bookings for ${notAllowed.join(', ')}.`)
  }

  const ref = db.collection('equipment_bookings').doc(bookingId)
  const caller = (await db.collection('users').doc(uid).get()).data() ?? {}
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Booking not found.')
    const b = snap.data()!
    if (!['pending', 'confirmed', 'denied', 'checked-out'].includes(b.status)) {
      throw new functions.https.HttpsError('failed-precondition', `This booking is ${b.status}.`)
    }
    const all = await bookingCategories(b.items ?? [])
    const setUp: Record<string, string> = b.setUpCategories ?? {}
    if (categories.some(c => !all.includes(c))) throw new functions.https.HttpsError('invalid-argument', 'Category not in this booking.')
    if (categories.some(c => setUp[c])) throw new functions.https.HttpsError('failed-precondition', 'That part is already set up in a project.')

    // Bookings decided before parts existed: their status covered every part
    const decisions: Record<string, unknown> = { ...(b.categoryDecisions ?? {}) }
    if (!b.categoryDecisions && (b.status === 'confirmed' || b.status === 'denied')) {
      for (const c of all) decisions[c] = { status: b.status, byUid: '', byName: '' }
    }
    for (const c of categories) {
      if (decision === 'pending') delete decisions[c]
      else decisions[c] = { status: decision, byUid: uid, byName: (caller.displayName as string) ?? '', at: admin.firestore.Timestamp.now() }
    }
    const statusOf = (c: string) => setUp[c] ? 'confirmed' : (decisions[c] as { status?: string } | undefined)?.status
    const undecided = all.some(c => !statusOf(c))
    const everyDenied = all.every(c => statusOf(c) === 'denied')
    const anySetUp = Object.keys(setUp).length > 0
    const status = anySetUp && b.status === 'checked-out'
      ? (all.every(c => setUp[c] || statusOf(c) === 'denied') ? 'checked-out' : 'confirmed')
      : undecided ? 'pending' : everyDenied ? 'denied' : 'confirmed'
    tx.update(ref, {
      categoryDecisions: decisions,
      status,
      ...(typeof note === 'string' && note.trim() ? { teacherNotes: note.trim().slice(0, 1000) } : {}),
    })
    return { status, booking: b, all, undecided }
  })

  // Tell the student which part was decided
  if (decision !== 'pending') {
    const b = result.booking
    const whole = categories.length === result.all.length
    const what = whole ? 'Your equipment' : `The ${categories.join(', ')} part of your equipment`
    const verb = decision === 'confirmed' ? 'confirmed' : 'denied'
    const extra = typeof note === 'string' && note.trim() ? `: ${note.trim()}` : ''
    const left = result.undecided ? ' — the rest is still being reviewed' : ''
    const opts = {
      title: decision === 'confirmed'
        ? (whole ? '✅ Equipment booking confirmed' : '✅ Part of your booking confirmed')
        : (whole ? '❌ Equipment booking denied' : '❌ Part of your booking denied'),
      body: `${what} for "${b.projectName}" was ${verb}${extra}${left}`,
      url: '/my-bookings',
    }
    const studentId = b.studentId as string
    if (studentId) {
      const tokens: string[] = await tokensFor([studentId])
      await Promise.all([
        sendPush(tokens, { ...opts, tag: 'equipment-booking' }),
        saveNotifications([studentId], opts),
      ])
    }
  }
  return { status: result.status }
})
