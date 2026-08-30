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

// 1. Show sync configs + cohort names
const syncsSnap = await db.collection('office_calendar_syncs').get()
const cohortIds = new Set()
const syncDocs = {}
console.log('\n=== office_calendar_syncs ===')
for (const d of syncsSnap.docs) {
  const data = d.data()
  syncDocs[d.id] = data
  cohortIds.add(data.cohortId)
  console.log(`  ${d.id}`)
  console.log(`    name:     ${data.name}`)
  console.log(`    cohortId: ${data.cohortId}`)
  console.log(`    enabled:  ${data.enabled}`)
}

// 2. Show cohort names
console.log('\n=== cohorts (classes) ===')
const cohortsSnap = await db.collection('cohorts').get()
for (const d of cohortsSnap.docs) {
  const data = d.data()
  console.log(`  ${d.id} → "${data.name}"`)
}

// 3. Show synced_events grouped by syncId with sample titles
const eventsSnap = await db.collection('synced_events').get()
console.log(`\n=== synced_events (${eventsSnap.size} total) ===`)

const bySyncId = {}
for (const d of eventsSnap.docs) {
  const data = d.data()
  if (!bySyncId[data.syncId]) bySyncId[data.syncId] = []
  bySyncId[data.syncId].push({ title: data.title, cohortId: data.cohortId, start: data.startTime?.toDate?.()?.toISOString()?.slice(0,16) })
}

for (const [syncId, events] of Object.entries(bySyncId)) {
  const sync = syncDocs[syncId]
  console.log(`\n  syncId: ${syncId}`)
  console.log(`    sync name:    ${sync?.name ?? 'UNKNOWN'}`)
  console.log(`    sync cohort:  ${sync?.cohortId ?? 'UNKNOWN'}`)
  console.log(`    event count:  ${events.length}`)
  console.log(`    sample titles:`)
  const unique = [...new Map(events.map(e => [e.title, e])).values()].slice(0, 10)
  for (const e of unique) {
    console.log(`      "${e.title}" at ${e.start} (cohortId: ${e.cohortId})`)
  }
}
