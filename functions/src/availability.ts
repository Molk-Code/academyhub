import { FieldValue } from 'firebase-admin/firestore'
import { functions, db, LIMITS, REGION, SCHOOL_ID, allow } from './lib'
import { hashIp, clientIp } from './contact'

// ─────────────────────────────────────────────────────────────────────────────
// Equipment availability per date, enforced on the server.
//
// A unit is taken on a day when it's in an equipment booking that holds it
// (pending, confirmed, or partly set up) or in an inventory project (planned
// or out). Bookings are created, and new units checked out, only through the
// functions below. Each one runs in a transaction that also writes a lock
// doc per item (equipment_locks/{equipmentId}), so two people can't take the
// last unit at the same moment: the second transaction retries, sees the
// first one's booking, and is refused.
//
// Dates are whole days, "YYYY-MM-DD", both ends included (a booking from the
// 3rd to the 5th holds the unit on the 3rd, 4th and 5th).
// ─────────────────────────────────────────────────────────────────────────────

export type Day = string
export interface Hold { from: Day; to: Day; qty: number }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export const MAX_RANGE_DAYS = 366

export function isDay(v: unknown): v is Day {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export function addDays(day: Day, n: number): Day {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Most units held on any single day from `from` to `to` (both included) */
export function peakHeld(holds: Hold[], from: Day, to: Day): number {
  const relevant = holds.filter(h => h.from <= to && h.to >= from)
  let peak = 0
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const n = relevant.reduce((s, h) => (h.from <= day && h.to >= day ? s + h.qty : s), 0)
    if (n > peak) peak = n
  }
  return peak
}

export const today = (): Day => new Date().toISOString().slice(0, 10)

// ── Who holds what ───────────────────────────────────────────────────────────

const HOLDING_BOOKING = ['pending', 'confirmed']
const HOLDING_PROJECT = ['active', 'checked-out']
/** Item rows that take a unit: planned (pending) or physically out */
const HOLDING_ITEM = ['pending', 'checked-out', 'damaged', 'missing']
/** Physically out: holds the unit until it's back, even past the project's return date */
const PHYSICALLY_OUT = ['checked-out', 'damaged', 'missing']

const keyOf = (it: { equipmentId?: string; equipmentName?: string }) => it.equipmentId || `name:${it.equipmentName ?? ''}`

type Reader = { get: (q: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot> }

/**
 * Holds per equipment id from bookings and projects that reach `from` or
 * later. `exclude` leaves out one booking or project (the one being changed).
 */
export async function holdsFor(read: Reader, equipmentIds: string[], from: Day, exclude: { bookingId?: string; projectId?: string } = {}) {
  const holds = new Map<string, Hold[]>(equipmentIds.map(id => [id, []]))
  const ids = new Set(equipmentIds)
  const now = today()

  const bookings = await read.get(db.collection('equipment_bookings').where('status', 'in', HOLDING_BOOKING).where('returnDate', '>=', from))
  for (const d of bookings.docs) {
    if (d.id === exclude.bookingId) continue
    const b = d.data()
    if (!isDay(b.checkoutDate) || !isDay(b.returnDate)) continue
    for (const it of (b.items ?? []) as { equipmentId?: string; equipmentName?: string; quantity?: number; category?: string }[]) {
      if (!it.equipmentId || !ids.has(it.equipmentId)) continue
      if (b.unavailableItems?.[keyOf(it)]) continue                       // staff said it isn't available
      if (it.category && b.categoryDecisions?.[it.category]?.status === 'denied') continue
      if (it.category && b.setUpCategories?.[it.category]) continue        // now held by its project's rows
      holds.get(it.equipmentId)!.push({ from: b.checkoutDate, to: b.returnDate, qty: Math.max(0, Number(it.quantity) || 0) })
    }
  }

  // Projects: every active one (few at a time), so overdue ones still count
  const projects = await read.get(db.collection('inventory_projects').where('status', 'in', HOLDING_PROJECT))
  const projectById = new Map(projects.docs.filter(p => p.id !== exclude.projectId).map(p => [p.id, p.data()]))
  for (let i = 0; i < equipmentIds.length; i += 30) {
    const rows = await read.get(db.collectionGroup('items').where('equipmentId', 'in', equipmentIds.slice(i, i + 30)))
    for (const r of rows.docs) {
      const parent = r.ref.parent.parent
      if (parent?.parent.id !== 'inventory_projects') continue
      const p = projectById.get(parent.id)
      if (!p) continue
      const row = r.data()
      if (!HOLDING_ITEM.includes(row.status)) continue
      const pFrom = isDay(p.checkoutDate) ? p.checkoutDate : now
      let pTo = isDay(p.returnDate) ? p.returnDate : pFrom
      if (PHYSICALLY_OUT.includes(row.status) && pTo < now) pTo = addDays(now, 365)   // overdue: out until it's back
      const startsFrom = PHYSICALLY_OUT.includes(row.status) && pFrom > now ? now : pFrom
      holds.get(row.equipmentId)?.push({ from: startsFrom, to: pTo, qty: 1 })
    }
  }
  return holds
}

export interface Shortfall { equipmentId: string; name: string; wanted: number; free: number }

/** Items in `wanted` that don't fit in [from, to] on top of what's already held */
export function shortfalls(
  wanted: Map<string, number>, total: Map<string, { name: string; total: number }>, holds: Map<string, Hold[]>, from: Day, to: Day,
): Shortfall[] {
  const out: Shortfall[] = []
  for (const [id, qty] of wanted) {
    const eq = total.get(id)
    if (!eq) continue   // not in the catalog (typed by hand): nothing to count against
    const free = Math.max(0, eq.total - peakHeld(holds.get(id) ?? [], from, to))
    if (qty > free) out.push({ equipmentId: id, name: eq.name, wanted: qty, free })
  }
  return out
}

export function shortfallMessage(s: Shortfall[], from: Day, to: Day): string {
  const when = from === to ? `on ${from}` : `from ${from} to ${to}`
  return `Not enough available ${when}: ${s.map(x => `${x.name} (${x.free === 0 ? 'none' : `only ${x.free}`} free, ${x.wanted} wanted)`).join(', ')}.`
}

async function catalog(read: { get: (r: FirebaseFirestore.DocumentReference) => Promise<FirebaseFirestore.DocumentSnapshot> }, ids: string[]) {
  const out = new Map<string, { name: string; total: number }>()
  await Promise.all(ids.map(async id => {
    const s = await read.get(db.collection('equipment').doc(id))
    // Units away for service (maintenance log) are never free
    if (s.exists) out.set(id, { name: String(s.data()?.name ?? id), total: Math.max(0, (Number(s.data()?.totalQuantity) || 0) - Math.max(0, Number(s.data()?.maintenanceUnits) || 0)) })
  }))
  return out
}

const lockRef = (equipmentId: string) => db.collection('equipment_locks').doc(equipmentId)

// ── School checks (what the rules check for client writes) ───────────────────

async function schoolDoc() {
  return (await db.collection('schools').doc(SCHOOL_ID).get()).data() ?? {}
}
function rentalOn(s: FirebaseFirestore.DocumentData) {
  return s.modules == null || s.modules.rentalInventory === true
}
/** Same as firestore.rules tierHasFeature('equipment') */
function equipmentFeatureOn(s: FirebaseFirestore.DocumentData) {
  const tier = s.tier ?? null
  return tier == null || tier === 'studio'
}
function shopOpen(s: FirebaseFirestore.DocumentData) {
  return s.modules == null ? s.productType === 'rental' : s.publicShop === true && s.modules?.rentalInventory === true
}

const bad = (msg: string) => new functions.https.HttpsError('invalid-argument', msg)

function checkRange(from: unknown, to: unknown): { from: Day; to: Day } {
  if (!isDay(from) || !isDay(to)) throw bad('Dates must look like 2026-11-14.')
  if (to < from) throw bad('The return date must be on or after the checkout date.')
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw bad(`At most ${MAX_RANGE_DAYS} days at a time.`)
  return { from, to }
}

// ── equipmentAvailability: free units per item for a date range ──────────────

export async function availabilityFor(from: Day, to: Day, equipmentIds?: string[]) {
  const ids = equipmentIds ?? (await db.collection('equipment').select().get()).docs.map(d => d.id)
  if (!ids.length) return {}
  const [cat, holds] = await Promise.all([catalog({ get: r => r.get() }, ids), holdsFor({ get: q => q.get() }, ids, from)])
  return Object.fromEntries(ids.filter(id => cat.has(id)).map(id => [id, Math.max(0, cat.get(id)!.total - peakHeld(holds.get(id) ?? [], from, to))]))
}

export const equipmentAvailability = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 5 }).https.onCall(async (data, context) => {
  const s = await schoolDoc()
  if (!rentalOn(s)) throw new functions.https.HttpsError('failed-precondition', 'Equipment booking is not on for this school.')
  if (!context.auth && !shopOpen(s)) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const who = context.auth?.uid ?? `ip_${await hashIp(clientIp(context.rawRequest as never))}`
  if (!(await allow(who, 'availability', 30))) throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Wait a minute and try again.')
  const d = (data ?? {}) as Record<string, unknown>
  const { from, to } = checkRange(d.from, d.to)
  const ids = Array.isArray(d.equipmentIds) ? (d.equipmentIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 500) : undefined
  return { from, to, available: await availabilityFor(from, to, ids) }
})

// ── createEquipmentBooking: the only way a booking is made ───────────────────

interface BookingItemIn { equipmentId: string; equipmentName: string; quantity: number; kitId?: string; kitName?: string }

function cleanItems(raw: unknown): BookingItemIn[] {
  if (!Array.isArray(raw) || !raw.length) throw bad('Add at least one item.')
  if (raw.length > 200) throw bad('Too many lines in one booking.')
  return raw.map((x: any) => {
    const quantity = Number(x?.quantity)
    if (typeof x?.equipmentId !== 'string' || !x.equipmentId || typeof x?.equipmentName !== 'string') throw bad('Each line needs an item.')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw bad('Quantities must be whole numbers from 1 to 999.')
    return {
      equipmentId: x.equipmentId, equipmentName: String(x.equipmentName).slice(0, 200), quantity,
      // Booked as part of a kit: shown with the kit's name
      ...(typeof x.kitId === 'string' && x.kitId ? { kitId: x.kitId.slice(0, 100), kitName: String(x.kitName ?? '').slice(0, 200) } : {}),
    }
  })
}

/** Fields a client may set on a new booking; everything else is the server's */
const STUDENT_FIELDS = ['studentName', 'studentEmail', 'cohortId', 'projectName', 'teacherNotes', 'productionId', 'productionTitle', 'productionReadiness', 'contactName', 'contactPhone', 'contactEmail']
const GUEST_FIELDS = ['guestName', 'guestPhone', 'projectName', 'teacherNotes', 'studentName', 'studentEmail', 'cohortId']

function pick(d: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (d[k] !== undefined) out[k] = typeof d[k] === 'string' ? String(d[k]).slice(0, 2000) : d[k]
  return out
}

/**
 * Checks every item against what's held on those dates and writes the booking,
 * in one transaction with a lock per item. Returns the new booking id.
 */
export async function placeBooking(fields: Record<string, unknown>, items: BookingItemIn[], from: Day, to: Day): Promise<string> {
  const wanted = new Map<string, number>()
  for (const it of items) wanted.set(it.equipmentId, (wanted.get(it.equipmentId) ?? 0) + it.quantity)
  const ids = [...wanted.keys()]
  const ref = db.collection('equipment_bookings').doc()
  await db.runTransaction(async tx => {
    await Promise.all(ids.map(id => tx.get(lockRef(id))))
    const cat = await catalog(tx, ids)
    const missing = ids.filter(id => !cat.has(id))
    if (missing.length) throw new functions.https.HttpsError('not-found', 'An item in the booking is no longer in the catalog. Reload and try again.')
    const holds = await holdsFor(tx, ids, from)
    const short = shortfalls(wanted, cat, holds, from, to)
    if (short.length) throw new functions.https.HttpsError('failed-precondition', shortfallMessage(short, from, to), { shortfalls: short })
    for (const id of ids) tx.set(lockRef(id), { at: FieldValue.serverTimestamp(), by: ref.id })
    tx.create(ref, { ...fields, items, checkoutDate: from, returnDate: to, status: 'pending', createdAt: FieldValue.serverTimestamp() })
  })
  return ref.id
}

export const createEquipmentBooking = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 10 }).https.onCall(async (data, context) => {
  const d = (data ?? {}) as Record<string, unknown>
  const s = await schoolDoc()
  if (!rentalOn(s)) throw new functions.https.HttpsError('failed-precondition', 'Equipment booking is not on for this school.')
  const items = cleanItems(d.items)
  const { from, to } = checkRange(d.checkoutDate, d.returnDate)
  if (from < addDays(today(), -1)) throw bad('The checkout date cannot be in the past.')

  if (context.auth) {
    if (!equipmentFeatureOn(s)) throw new functions.https.HttpsError('permission-denied', 'Equipment booking is not part of this plan.')
    if (!(await allow(context.auth.uid, 'booking-create', 10))) throw new functions.https.HttpsError('resource-exhausted', 'Too many bookings at once. Wait a minute.')
    const id = await placeBooking({ ...pick(d, STUDENT_FIELDS), studentId: context.auth.uid }, items, from, to)
    return { bookingId: id }
  }

  // Signed-out guest in the public rental shop
  if (!shopOpen(s)) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.')
  const guestEmail = typeof d.guestEmail === 'string' ? d.guestEmail.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guestEmail)) throw bad('A valid email address is required.')
  const ipHash = await hashIp(clientIp(context.rawRequest as never))
  if (!(await allow(`ip_${ipHash}`, 'shop-booking', 3, 60 * 60_000))) throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Please try again later.')
  const id = await placeBooking({ ...pick(d, GUEST_FIELDS), guestEmail, isGuest: true, studentId: '' }, items, from, to)
  return { bookingId: id }
})

// ── checkOutUnits: new units out in a project, only if they're free ──────────

interface UnitIn { equipmentId: string; equipmentName: string; unit?: number | null; scannedViaSession?: string; notInBooking?: boolean }

/**
 * Adds checked-out rows to a project. Each catalog unit must be free on the
 * project's dates (counting bookings and other projects); a numbered unit
 * (#3) must not be out in any other project. Rows not from the catalog
 * (typed by hand) are added without a check.
 */
export async function checkOutUnits(projectId: string, units: UnitIn[], assignedTo: string): Promise<string[]> {
  const projectRef = db.collection('inventory_projects').doc(projectId)
  const ids = [...new Set(units.map(u => u.equipmentId).filter(Boolean))]
  return db.runTransaction(async tx => {
    await Promise.all(ids.map(id => tx.get(lockRef(id))))
    const pSnap = await tx.get(projectRef)
    if (!pSnap.exists) throw new functions.https.HttpsError('not-found', 'Project not found.')
    const p = pSnap.data()!
    if (!HOLDING_PROJECT.includes(p.status)) throw new functions.https.HttpsError('failed-precondition', 'This project is closed.')
    const now = today()
    const from = isDay(p.checkoutDate) && p.checkoutDate > now ? now : (isDay(p.checkoutDate) ? p.checkoutDate : now)
    const to = isDay(p.returnDate) && p.returnDate >= now ? p.returnDate : now

    // Numbered units: out anywhere else?
    const unitRefs = units.filter(u => u.equipmentId && u.unit != null).map(u => db.collection('equipment_units').doc(`${u.equipmentId}__${u.unit}`))
    const unitSnaps = await Promise.all(unitRefs.map(r => tx.get(r)))
    for (const us of unitSnaps) {
      const held = us.data()
      if (!held?.projectId || !held?.itemId) continue
      const row = await tx.get(db.collection('inventory_projects').doc(held.projectId).collection('items').doc(held.itemId))
      if (row.exists && PHYSICALLY_OUT.includes(row.data()!.status)) {
        const other = held.projectId === projectId ? 'this project' : `project "${(await tx.get(db.collection('inventory_projects').doc(held.projectId))).data()?.name ?? held.projectId}"`
        throw new functions.https.HttpsError('already-exists', `${row.data()!.equipmentName} is already out in ${other}.`)
      }
    }

    // Numbered units away for service (maintenance) can't go out
    const numbered = units.filter(u => u.equipmentId && u.unit != null)
    const equipSnaps = new Map((await Promise.all([...new Set(numbered.map(u => u.equipmentId!))]
      .map(async id => [id, await tx.get(db.collection('equipment').doc(id))] as const))))
    for (const u of numbered) {
      const away = (equipSnaps.get(u.equipmentId!)?.data()?.serviceUnits ?? []) as { unit: number }[]
      if (away.some(a => a.unit === u.unit)) {
        throw new functions.https.HttpsError('failed-precondition', `${/#\d+$/.test(u.equipmentName) ? u.equipmentName : `${u.equipmentName} #${u.unit}`} is in service (Equipment → Maintenance) and can't be checked out.`)
      }
    }

    if (ids.length) {
      const wanted = new Map<string, number>()
      for (const u of units) if (u.equipmentId) wanted.set(u.equipmentId, (wanted.get(u.equipmentId) ?? 0) + 1)
      const cat = await catalog(tx, ids)
      const holds = await holdsFor(tx, ids, from)   // includes this project's own rows
      const short = shortfalls(wanted, cat, holds, from, to)
      if (short.length) throw new functions.https.HttpsError('failed-precondition', shortfallMessage(short, from, to), { shortfalls: short })
    }

    const stamp = new Date().toISOString()
    const created: string[] = []
    units.forEach(u => {
      const rowRef = projectRef.collection('items').doc()
      tx.create(rowRef, {
        equipmentId: u.equipmentId ?? '', equipmentName: u.equipmentName, checkoutTimestamp: stamp, checkinTimestamp: '',
        status: 'checked-out', damageNotes: '', assignedTo, ...(u.unit != null ? { unit: u.unit } : {}),
        ...(u.equipmentId ? {} : { isManualEntry: true }),
        ...(u.scannedViaSession ? { scannedViaSession: u.scannedViaSession } : {}),
        ...(u.notInBooking ? { notInBooking: true } : {}),
      })
      created.push(rowRef.id)
      if (u.equipmentId && u.unit != null) {
        tx.set(db.collection('equipment_units').doc(`${u.equipmentId}__${u.unit}`), { projectId, itemId: rowRef.id, at: FieldValue.serverTimestamp() })
        tx.set(projectRef.collection('unit_out').doc(`${u.equipmentId}__${u.unit}`), { itemId: rowRef.id })
      }
    })
    for (const id of ids) tx.set(lockRef(id), { at: FieldValue.serverTimestamp(), by: projectId })
    return created
  })
}

export const checkOutEquipmentUnits = functions.region(REGION).runWith({ ...LIMITS, maxInstances: 10 }).https.onCall(async (data, context) => {
  const role = context.auth?.token.role
  if (role !== 'teacher' && role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Staff only.')
  const s = await schoolDoc()
  if (!rentalOn(s) || !(role === 'admin' || equipmentFeatureOn(s))) throw new functions.https.HttpsError('failed-precondition', 'Inventory is not on for this school.')
  const d = (data ?? {}) as Record<string, unknown>
  if (typeof d.projectId !== 'string' || !d.projectId) throw bad('projectId is required.')
  if (!Array.isArray(d.units) || !d.units.length || d.units.length > 200) throw bad('Between 1 and 200 units at a time.')
  const units: UnitIn[] = (d.units as any[]).map(u => {
    if (typeof u?.equipmentName !== 'string' || !u.equipmentName.trim()) throw bad('Each unit needs a name.')
    const unit = u.unit === undefined || u.unit === null ? null : Number(u.unit)
    if (unit !== null && (!Number.isInteger(unit) || unit < 1 || unit > 9999)) throw bad('Unit numbers are whole numbers.')
    return {
      equipmentId: typeof u.equipmentId === 'string' ? u.equipmentId : '', equipmentName: u.equipmentName.trim().slice(0, 200), unit,
      ...(typeof u.scannedViaSession === 'string' ? { scannedViaSession: u.scannedViaSession.slice(0, 100) } : {}),
      ...(u.notInBooking === true ? { notInBooking: true } : {}),
    }
  })
  const assignedTo = typeof d.assignedTo === 'string' ? d.assignedTo.slice(0, 200) : ''
  return { itemIds: await checkOutUnits(d.projectId, units, assignedTo) }
})

