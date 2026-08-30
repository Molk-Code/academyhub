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

// 1. Load all sync configs → build correct syncId → cohortId map
const syncsSnap = await db.collection('office_calendar_syncs').get()
const syncMap = {}
console.log('\n=== Sync configs ===')
for (const d of syncsSnap.docs) {
  const data = d.data()
  syncMap[d.id] = data.cohortId ?? 'all'
  console.log(`  ${d.id} → cohortId: ${data.cohortId} (${data.name})`)
}

// 2. Load all synced_events
const eventsSnap = await db.collection('synced_events').get()
console.log(`\nTotal synced_events: ${eventsSnap.size}`)

// 3. Find mismatches and duplicates
const toDelete = []
const seen = new Map() // externalId → docId (for dedup)

for (const d of eventsSnap.docs) {
  const data = d.data()
  const { syncId, cohortId, externalId } = data
  const expectedCohortId = syncMap[syncId]

  if (expectedCohortId === undefined) {
    // Orphaned — syncId no longer exists
    console.log(`  ORPHAN   ${d.id} (syncId "${syncId}" not in sync configs)`)
    toDelete.push({ id: d.id, reason: 'orphaned syncId' })
    continue
  }

  if (cohortId !== expectedCohortId) {
    console.log(`  MISMATCH ${d.id}  cohortId="${cohortId}" but sync says "${expectedCohortId}"`)
    toDelete.push({ id: d.id, reason: `wrong cohortId: has ${cohortId}, should be ${expectedCohortId}` })
    continue
  }

  // Dedup: same externalId should appear at most once per syncId
  const key = `${syncId}_${externalId}`
  if (seen.has(key)) {
    console.log(`  DUPE     ${d.id}  (same externalId as ${seen.get(key)})`)
    toDelete.push({ id: d.id, reason: 'duplicate externalId' })
  } else {
    seen.set(key, d.id)
  }
}

console.log(`\n=== To delete: ${toDelete.length} docs ===`)
if (toDelete.length === 0) {
  console.log('Nothing to clean up.')
  process.exit(0)
}
for (const { id, reason } of toDelete) {
  console.log(`  ${id}  (${reason})`)
}

// Batch delete
const BATCH_SIZE = 400
for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
  const batch = db.batch()
  toDelete.slice(i, i + BATCH_SIZE).forEach(({ id }) => {
    batch.delete(db.collection('synced_events').doc(id))
  })
  await batch.commit()
  console.log(`Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}`)
}

console.log('\nDone. Power Automate will re-send events on next trigger.')
