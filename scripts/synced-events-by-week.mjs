// Count synced Office events per ISO week (and per sync), to spot gaps.
// Usage: node scripts/synced-events-by-week.mjs
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))) })
const db = admin.firestore()

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y = t.getUTCFullYear()
  return `${y}-W${String(Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0')}`
}

const syncs = await db.collection('office_calendar_syncs').get()
for (const s of syncs.docs) {
  const d = s.data()
  console.log(`sync ${s.id}: name=${d.name ?? d.label ?? ''} cohort=${d.cohortId ?? 'all'} enabled=${d.enabled !== false} lastReceived=${d.lastReceivedAt?.toDate().toISOString() ?? '-'} count=${d.eventCount ?? 0}`)
}
const snap = await db.collection('synced_events').get()
const weeks = {}
for (const e of snap.docs) {
  const st = e.data().startTime?.toDate()
  if (!st) continue
  const k = isoWeek(st)
  ;(weeks[k] ??= {})[e.data().syncId] = ((weeks[k] ??= {})[e.data().syncId] ?? 0) + 1
}
for (const k of Object.keys(weeks).sort()) console.log(k, JSON.stringify(weeks[k]))
process.exit(0)
