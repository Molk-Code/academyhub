// Run with: node scripts/migrate-cohorts-to-classes.mjs
// Copies all documents from 'cohorts' collection to 'classes' collection,
// preserving document IDs. Safe to re-run (idempotent).
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const serviceAccount = require('./serviceAccountKey.json')

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const snap = await db.collection('cohorts').get()
console.log(`Found ${snap.size} cohort documents to migrate.`)

let copied = 0
const batch = db.batch()
for (const docSnap of snap.docs) {
  batch.set(db.collection('classes').doc(docSnap.id), docSnap.data())
  copied++
}
await batch.commit()
console.log(`✓ Copied ${copied} documents from 'cohorts' → 'classes'.`)
console.log('Old cohorts collection preserved as backup.')
