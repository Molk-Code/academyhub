// Availability per date and double-booking prevention (availability.ts),
// against the Firestore emulator:  npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db } = await import('../lib/lib.js')
const av = await import('../lib/availability.js')

const day = n => av.addDays(av.today(), n)
const line = (qty = 1) => [{ equipmentId: 'cam', equipmentName: 'FX6', quantity: qty }]
const booking = (from, to, qty = 1) => av.placeBooking({ studentId: 'u1', projectName: 'Test' }, line(qty), day(from), day(to))
const refused = e => e.code === 'failed-precondition' && /Not enough available/.test(e.message)

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.collection('equipment').doc('cam').set({ name: 'FX6', totalQuantity: 2, available: 2 })
})

test('dates and peaks', () => {
  assert.ok(av.isDay('2026-02-28'))
  assert.ok(!av.isDay('2026-02-30'))
  assert.ok(!av.isDay('2026-2-3'))
  assert.equal(av.addDays('2026-12-31', 1), '2027-01-01')
  const holds = [{ from: '2026-01-03', to: '2026-01-05', qty: 1 }, { from: '2026-01-06', to: '2026-01-08', qty: 1 }, { from: '2026-01-05', to: '2026-01-06', qty: 1 }]
  assert.equal(av.peakHeld(holds, '2026-01-01', '2026-01-02'), 0)
  assert.equal(av.peakHeld(holds, '2026-01-03', '2026-01-08'), 2, 'two holds never overlap the third at once')
  assert.equal(av.peakHeld(holds, '2026-01-05', '2026-01-05'), 2)
})

test('bookings: overlapping dates take units, adjacent ones do not', async () => {
  await booking(3, 5, 2)
  await assert.rejects(booking(5, 7), refused, 'both units held on day 5')
  await booking(6, 7, 2)
  await assert.rejects(booking(1, 3), refused)
  await booking(1, 2, 2)
  const a = await av.availabilityFor(day(1), day(10), ['cam'])
  assert.equal(a.cam, 0)
  assert.equal((await av.availabilityFor(day(8), day(10), ['cam'])).cam, 2)
})

test('released holds: cancelled, denied, unavailable and set-up parts free the unit', async () => {
  const id = await booking(3, 5, 2)
  await assert.rejects(booking(4, 4), refused)
  await db.collection('equipment_bookings').doc(id).update({ status: 'cancelled' })
  const id2 = await booking(4, 4, 2)
  await db.collection('equipment_bookings').doc(id2).update({ 'items': [{ equipmentId: 'cam', equipmentName: 'FX6', quantity: 2, category: 'Camera' }], 'categoryDecisions.Camera': { status: 'denied' } })
  const id3 = await booking(4, 4, 2)
  await db.collection('equipment_bookings').doc(id3).update({ unavailableItems: { cam: { byUid: 's' } } })
  await booking(4, 4, 2)
})

test('two people booking the last unit at the same moment: exactly one gets it', async () => {
  await booking(3, 5, 1)
  const results = await Promise.allSettled([booking(4, 4), booking(4, 5), booking(2, 4)])
  const ok = results.filter(r => r.status === 'fulfilled').length
  assert.equal(ok, 1, JSON.stringify(results.map(r => r.status)))
  assert.ok(results.filter(r => r.status === 'rejected').every(r => refused(r.reason)))
})

test('projects: planned rows and units out count; overdue units hold until returned', async () => {
  const p = db.collection('inventory_projects').doc('p1')
  await p.set({ name: 'Shoot', status: 'active', checkoutDate: day(-3), returnDate: day(-1) })
  await p.collection('items').add({ equipmentId: 'cam', equipmentName: 'FX6', status: 'checked-out' })   // overdue
  await p.collection('items').add({ equipmentId: 'cam', equipmentName: 'FX6', status: 'returned' })
  assert.equal((await av.availabilityFor(day(0), day(30), ['cam'])).cam, 1, 'overdue unit still out')
  const q = db.collection('inventory_projects').doc('p2')
  await q.set({ name: 'Later', status: 'active', checkoutDate: day(10), returnDate: day(12) })
  await q.collection('items').add({ equipmentId: 'cam', equipmentName: 'FX6', status: 'pending' })
  await assert.rejects(booking(11, 11), refused)
  await booking(13, 14)
})

test('check-out: only free units, and a numbered unit out in one project only', async () => {
  const mk = async (id, from, to) => {
    await db.collection('inventory_projects').doc(id).set({ name: id, status: 'active', checkoutDate: day(from), returnDate: day(to) })
  }
  await mk('a', 0, 3)
  await mk('b', 0, 2)
  await av.checkOutUnits('a', [{ equipmentId: 'cam', equipmentName: 'FX6 #1', unit: 1 }], 'Kim')
  await assert.rejects(av.checkOutUnits('b', [{ equipmentId: 'cam', equipmentName: 'FX6 #1', unit: 1 }], 'Sam'), e => e.code === 'already-exists' && /out in project "a"/.test(e.message))
  await booking(1, 2, 1)   // the second unit is booked on days 1–2
  await assert.rejects(av.checkOutUnits('b', [{ equipmentId: 'cam', equipmentName: 'FX6 #2', unit: 2 }], 'Sam'), refused)
  await av.checkOutUnits('b', [{ equipmentId: '', equipmentName: 'Gaffer tape' }], 'Sam')   // not in the catalog: no check
  const rows = await db.collection('inventory_projects').doc('b').collection('items').get()
  assert.deepEqual(rows.docs.map(d => d.data().equipmentName), ['Gaffer tape'])
  assert.equal(rows.docs[0].data().isManualEntry, true)
})
