// Contract signing when borrowers change after the contract was sent: only
// people who haven't signed the contract as it stands are asked. Against the
// Firestore emulator:
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db } = await import('../lib/lib.js')
const signing = await import('../lib/equipment-signing.js')

const staff = { auth: { uid: 'teacher', token: { role: 'teacher' } } }
const as = uid => ({ auth: { uid, token: { role: 'student', email: `${uid}@example.test` } }, rawRequest: { headers: {}, ip: '127.0.0.1' } })
const proj = () => db.collection('inventory_projects').doc('p')
const request = () => signing.requestEquipmentSignatures.run({ projectId: 'p' }, staff)

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.collection('users').doc('teacher').set({ displayName: 'Teacher', role: 'teacher' })
  for (const u of ['alva', 'bo']) await db.collection('users').doc(u).set({ displayName: u, role: 'student', roles: ['student'] })
  await proj().set({ name: 'Short film', borrowers: ['alva'], borrowerIds: ['alva'], checkoutDate: '2026-11-18', returnDate: '2026-11-25', status: 'active' })
  await proj().collection('items').doc('i1').set({ equipmentId: 'x', equipmentName: 'Tripod', status: 'checked-out' })
})

test('a borrower added after signing is asked; the one who signed is not', async () => {
  assert.equal((await request()).notified, 1)
  await signing.signEquipmentContract.run({ projectId: 'p', typedName: 'Alva A', accepted: true }, as('alva'))
  assert.deepEqual((await proj().get()).data().pendingSignatureUids, [])

  await proj().update({ borrowers: ['alva', 'bo'], borrowerIds: ['alva', 'bo'] })
  const r = await request()
  assert.equal(r.notified, 1)
  assert.equal(r.alreadySigned, 1)
  assert.deepEqual((await proj().get()).data().pendingSignatureUids, ['bo'])

  await signing.signEquipmentContract.run({ projectId: 'p', typedName: 'Bo B', accepted: true }, as('bo'))
  assert.equal((await proj().collection('signatures').get()).size, 2)
})

test('a removed borrower can no longer sign', async () => {
  await request()
  await proj().update({ borrowers: [], borrowerIds: [], pendingSignatureUids: [] })
  await assert.rejects(signing.signEquipmentContract.run({ projectId: 'p', typedName: 'Alva A', accepted: true }, as('alva')), e => e.code === 'permission-denied')
})
