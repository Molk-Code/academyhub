// Single items of an equipment booking: not available / available again.
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db } = await import('../lib/lib.js')
const { runSetBookingItems } = await import('../lib/equipment.js')

const get = async () => (await db.collection('equipment_bookings').doc('b1').get()).data()

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.collection('users').doc('t1').set({ displayName: 'Tove' })
  await db.collection('users').doc('t2').set({ displayName: 'Sound person' })
  await db.collection('settings').doc('equipment').set({ responsibility: { t2: ['SOUND'] } })
  await db.collection('equipment_bookings').doc('b1').set({
    studentId: 's1', projectName: 'Short', status: 'pending',
    items: [
      { equipmentId: 'cam', equipmentName: 'Camera', quantity: 1, category: 'CAMERA' },
      { equipmentId: 'lens', equipmentName: 'Lens', quantity: 1, category: 'CAMERA' },
      { equipmentId: 'mic', equipmentName: 'Mic', quantity: 2, category: 'SOUND' },
    ],
  })
})

test('an item marked not available is recorded; the part stays open', async () => {
  const r = await runSetBookingItems('t1', { bookingId: 'b1', keys: ['lens'], available: false })
  assert.equal(r.status, 'pending')
  const b = await get()
  assert.equal(b.unavailableItems.lens.byName, 'Tove')
  assert.equal(b.categoryDecisions?.CAMERA, undefined)
})

test('every item of a part unavailable denies the part; one back reopens it', async () => {
  await runSetBookingItems('t1', { bookingId: 'b1', keys: ['mic'], available: false })
  let b = await get()
  assert.equal(b.categoryDecisions.SOUND.status, 'denied')
  assert.equal(b.categoryDecisions.SOUND.auto, true)
  assert.equal(b.status, 'pending', 'camera part still undecided')

  await runSetBookingItems('t1', { bookingId: 'b1', keys: ['mic'], available: true })
  b = await get()
  assert.equal(b.categoryDecisions.SOUND, undefined)
  assert.equal(b.unavailableItems.mic, undefined)
})

test('whole booking unavailable: denied', async () => {
  const r = await runSetBookingItems('t1', { bookingId: 'b1', keys: ['cam', 'lens', 'mic'], available: false })
  assert.equal(r.status, 'denied')
})

test('only staff responsible for the category; not after set-up', async () => {
  await assert.rejects(runSetBookingItems('t2', { bookingId: 'b1', keys: ['cam'], available: false }), /don't handle bookings for CAMERA/)
  await runSetBookingItems('t2', { bookingId: 'b1', keys: ['mic'], available: false })
  await db.collection('equipment_bookings').doc('b1').update({ setUpCategories: { CAMERA: 'p1' } })
  await assert.rejects(runSetBookingItems('t1', { bookingId: 'b1', keys: ['lens'], available: false }), /already set up/)
  await assert.rejects(runSetBookingItems('t1', { bookingId: 'b1', keys: ['nope'], available: false }), /not in this booking/)
})
