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

// Cohort names
const cohorts = {
  dNQ7lWzOaUdBb3Ol0PpT: 'Film 1 (Åk 1)',
  zC54HFHn49lT5pGvZD2E: 'Film 2 (Åk 2)',
}

const weekStart = new Date('2026-08-17T00:00:00Z')
const weekEnd   = new Date('2026-08-24T00:00:00Z')

const eventsSnap = await db.collection('synced_events')
  .where('startTime', '>=', require('firebase-admin/firestore').Timestamp.fromDate(weekStart))
  .where('startTime', '<',  require('firebase-admin/firestore').Timestamp.fromDate(weekEnd))
  .get()

console.log(`\n=== Synced events Aug 17–23 (${eventsSnap.size} total) ===\n`)

// Group by cohortId
const byDate = {}
for (const d of eventsSnap.docs) {
  const data = d.data()
  const date = data.startTime.toDate().toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' })
  const cohortLabel = cohorts[data.cohortId] ?? data.cohortId
  const key = `${date} | ${cohortLabel}`
  if (!byDate[key]) byDate[key] = []
  byDate[key].push(data.title)
}

for (const [key, titles] of Object.entries(byDate).sort()) {
  console.log(`  ${key}`)
  for (const t of titles) console.log(`    - ${t}`)
}

// Also check: what events are in Film 2 that look like they belong to Åk 1?
console.log('\n=== Events in Film 2 this week ===')
for (const d of eventsSnap.docs) {
  const data = d.data()
  if (data.cohortId === 'zC54HFHn49lT5pGvZD2E') {
    const time = data.startTime.toDate().toISOString().slice(0,16)
    console.log(`  [${data.syncId}] "${data.title}" at ${time}`)
  }
}

console.log('\n=== Events in Film 1 this week ===')
for (const d of eventsSnap.docs) {
  const data = d.data()
  if (data.cohortId === 'dNQ7lWzOaUdBb3Ol0PpT') {
    const time = data.startTime.toDate().toISOString().slice(0,16)
    console.log(`  [${data.syncId}] "${data.title}" at ${time}`)
  }
}
