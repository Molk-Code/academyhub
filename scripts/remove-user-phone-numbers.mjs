// One-off cleanup: phone numbers are no longer collected, so delete the
// stored phoneNumber field from every user doc.
//
//   node scripts/remove-user-phone-numbers.mjs
import admin from 'firebase-admin'
import { readFileSync } from 'fs'

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))),
})
const db = admin.firestore()
const { FieldValue } = admin.firestore

const users = await db.collection('users').get()
let cleared = 0
const bulk = db.bulkWriter()
for (const d of users.docs) {
  if ('phoneNumber' in d.data()) {
    bulk.update(d.ref, { phoneNumber: FieldValue.delete() })
    cleared++
  }
}
await bulk.close()
console.log(`removed phoneNumber from ${cleared} of ${users.size} user docs`)
