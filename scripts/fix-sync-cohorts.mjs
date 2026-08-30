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

// Correct mapping (confirmed from event content analysis):
// pwOErqJYagPPgA8NcOeF = Åk 1 calendar → Film 1 cohort (dNQ7lWzOaUdBb3Ol0PpT)
// OeOdolMgm6BmwM5t1QSz = Åk 2 calendar → Film 2 cohort (zC54HFHn49lT5pGvZD2E)
const SYNC_FIXES = [
  {
    syncId: 'pwOErqJYagPPgA8NcOeF',
    correctCohortId: 'dNQ7lWzOaUdBb3Ol0PpT',
    name: 'Åk 1 Film - Creating & Producing',
  },
  {
    syncId: 'OeOdolMgm6BmwM5t1QSz',
    correctCohortId: 'zC54HFHn49lT5pGvZD2E',
    name: 'Åk 2 Film - Creating & Producing',
  },
]

console.log('=== Fixing sync cohort mappings ===\n')

for (const fix of SYNC_FIXES) {
  // 1. Update sync config doc
  const syncRef = db.collection('office_calendar_syncs').doc(fix.syncId)
  const syncSnap = await syncRef.get()
  if (!syncSnap.exists) {
    console.log(`WARN: sync ${fix.syncId} not found — skipping`)
    continue
  }
  const currentData = syncSnap.data()
  console.log(`Sync ${fix.syncId}:`)
  console.log(`  Current name="${currentData.name}" cohortId="${currentData.cohortId}"`)
  console.log(`  → Setting name="${fix.name}" cohortId="${fix.correctCohortId}"`)
  await syncRef.update({ cohortId: fix.correctCohortId, name: fix.name })

  // 2. Update all synced_events for this syncId
  const eventsSnap = await db.collection('synced_events')
    .where('syncId', '==', fix.syncId)
    .get()

  console.log(`  Updating ${eventsSnap.size} synced_events...`)
  const BATCH_SIZE = 400
  const docs = eventsSnap.docs
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    docs.slice(i, i + BATCH_SIZE).forEach(d => {
      batch.update(d.ref, { cohortId: fix.correctCohortId })
    })
    await batch.commit()
    console.log(`    Batch ${Math.floor(i / BATCH_SIZE) + 1} committed`)
  }
  console.log(`  Done.\n`)
}

console.log('=== All done. Film 1 → Åk 1, Film 2 → Åk 2 ===')
