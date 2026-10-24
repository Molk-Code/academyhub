// Read-only: groups recent _client_errors by message + context.
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
const key = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))
admin.initializeApp({ credential: admin.credential.cert(key) })
const db = admin.firestore()
const days = Number(process.argv[2] ?? 30)
const since = new Date(Date.now() - days * 864e5)
const snap = await db.collection('_client_errors').where('ts', '>=', since).orderBy('ts', 'desc').get()
const groups = new Map()
for (const d of snap.docs) {
  const e = d.data()
  const k = `${e.message} || ${e.context}`
  const g = groups.get(k) ?? { n: 0, last: null, urls: new Set(), uas: new Set(), stack: e.stack }
  g.n++; g.last ??= e.ts?.toDate?.().toISOString(); g.urls.add(e.url?.replace(/^https?:\/\/[^/]+/, '')); g.uas.add((e.ua ?? '').slice(0, 90))
  groups.set(k, g)
}
console.log(`${snap.size} errors in last ${days} days, ${groups.size} groups\n`)
for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`[${g.n}x] last ${g.last}\n  ${k}\n  urls: ${[...g.urls].slice(0, 6).join(', ')}\n  ua: ${[...g.uas].slice(0, 2).join(' | ')}\n  stack: ${(g.stack ?? '').split('\n').slice(0, 4).join(' / ')}\n`)
}
process.exit(0)
