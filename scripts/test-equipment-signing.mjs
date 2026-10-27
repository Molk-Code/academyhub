// End-to-end test of contract e-signing against production, using only the
// seeded Test Teacher / Test Student accounts and a temporary project.
// Usage: node scripts/test-equipment-signing.mjs setup | cleanup
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))) })
const db = admin.firestore()
const API_KEY = 'AIzaSyDU7rdWOm34fSOxsKxK9xafFw0zGyH4eX4'
const FN = 'https://us-central1-academy-hub-c252f.cloudfunctions.net'
const NAME = 'ZZ Signing test (temporary)'
const student = (await admin.auth().getUserByEmail('test-student@cineforge.app')).uid
const teacher = (await admin.auth().getUserByEmail('test-teacher@cineforge.app')).uid
const admin2 = (await admin.auth().getUserByEmail('test-admin@cineforge.app')).uid // requests when the teacher is a borrower

async function idToken(uid) {
  const custom = await admin.auth().createCustomToken(uid)
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://academy-hub-c252f.web.app/' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  })
  return (await r.json()).idToken
}
async function call(name, uid, data) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}`, 'User-Agent': 'signing-test-script' },
    body: JSON.stringify({ data }),
  })
  return { status: r.status, body: await r.json() }
}

if (process.argv[2] === 'cleanup') {
  for (const d of (await db.collection('inventory_projects').where('name', '==', NAME).get()).docs) {
    await db.recursiveDelete(d.ref); console.log('deleted project', d.id)
  }
  const notes = await db.collection('notifications').where('uid', 'in', [student, teacher]).where('title', '==', 'Sign equipment contract').get()
  for (const d of notes.docs) await d.ref.delete()
  console.log('deleted', notes.size, 'test notifications')
  process.exit(0)
}

const ref = await db.collection('inventory_projects').add({
  name: NAME, borrowers: ['Test Student'], borrowerIds: [student], equipmentManagerId: teacher, equipmentManagerName: 'Test Teacher',
  cohortId: '', checkoutDate: '2026-10-26', returnDate: '2026-10-30', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(),
})
await ref.collection('items').add({ equipmentId: '', equipmentName: 'Test Camera #1', checkoutTimestamp: '', checkinTimestamp: '', status: 'pending', damageNotes: '', assignedTo: 'Test Student' })
console.log('project', ref.id)

console.log('student tries request (should be denied):', (await call('requestEquipmentSignatures', student, { projectId: ref.id })).status)
console.log('teacher request:', JSON.stringify((await call('requestEquipmentSignatures', teacher, { projectId: ref.id })).body))
console.log('teacher (not borrower) tries to sign (should be denied):', (await call('signEquipmentContract', teacher, { projectId: ref.id, typedName: 'X Y', accepted: true })).status)
console.log('student signs without accepting (should fail):', (await call('signEquipmentContract', student, { projectId: ref.id, typedName: 'Test Student', accepted: false })).status)
console.log('student signs:', JSON.stringify((await call('signEquipmentContract', student, { projectId: ref.id, typedName: 'Test Student', accepted: true })).body))
console.log('teacher request again (should notify 0):', JSON.stringify((await call('requestEquipmentSignatures', teacher, { projectId: ref.id })).body))

const sig = (await ref.collection('signatures').get()).docs[0].data()
console.log('stored signature:', JSON.stringify({ ...sig, signedAt: sig.signedAt.toDate().toISOString(), snapshot: { ...sig.snapshot, legalText: sig.snapshot.legalText.slice(0, 40) + '…' } }, null, 1))

// Rules: student may read own signature but never write one directly
const tok = await idToken(student)
const base = `https://firestore.googleapis.com/v1/projects/academy-hub-c252f/databases/(default)/documents/inventory_projects/${ref.id}/signatures`
const w = await fetch(`${base}?documentId=forged`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { uid: { stringValue: student } } }) })
console.log('student direct write (should be 403):', w.status)
const q = await fetch(`https://firestore.googleapis.com/v1/projects/academy-hub-c252f/databases/(default)/documents/inventory_projects/${ref.id}:runQuery`, {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'signatures' }], where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: student } } } } }),
})
console.log('student reads own signatures:', q.status, (await q.json()).filter(x => x.document).length, 'doc(s)')
const notes = await db.collection('notifications').where('uid', '==', student).where('title', '==', 'Sign equipment contract').get()
console.log('notifications saved for Test Student:', notes.size, notes.docs.map(d => d.data().url))

// Teacher as borrower: notified with the teacher My Bookings link, can sign
await ref.update({ borrowers: ['Test Student', 'Test Teacher'], borrowerIds: [student, teacher] })
console.log('admin request with teacher borrower:', JSON.stringify((await call('requestEquipmentSignatures', admin2, { projectId: ref.id })).body))
const tNotes = await db.collection('notifications').where('uid', '==', teacher).where('title', '==', 'Sign equipment contract').get()
console.log('teacher notification urls:', tNotes.docs.map(d => d.data().url))
console.log('teacher signs:', (await call('signEquipmentContract', teacher, { projectId: ref.id, typedName: 'Test Teacher', accepted: true })).status)
process.exit(0)
