import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, 'serviceAccountKey.json'))

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// Print current sync config state first
console.log('=== Current sync configs ===')
const syncsSnap = await db.collection('office_calendar_syncs').get()
for (const d of syncsSnap.docs) {
  const data = d.data()
  console.log(`  ${d.id} → "${data.name}" → cohortId: ${data.cohortId}`)
}

// Delete ALL synced_events
const eventsSnap = await db.collection('synced_events').get()
console.log(`\nDeleting ${eventsSnap.size} synced_events...`)

const BATCH_SIZE = 400
const docs = eventsSnap.docs
for (let i = 0; i < docs.length; i += BATCH_SIZE) {
  const batch = db.batch()
  docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref))
  await batch.commit()
  console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} deleted`)
}

console.log('\nDone. All synced_events cleared.')
console.log('Sync configs are correct — trigger Power Automate to re-sync.')
