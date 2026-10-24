// Read-only: full details of _client_errors whose message contains a string.
// Usage: node scripts/show-client-errors.mjs "insufficient permissions" [days]
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
const key = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))
admin.initializeApp({ credential: admin.credential.cert(key) })
const db = admin.firestore()
const [needle, days = 60] = process.argv.slice(2)
const snap = await db.collection('_client_errors').where('ts', '>=', new Date(Date.now() - days * 864e5)).orderBy('ts', 'desc').get()
const users = new Map()
for (const d of snap.docs.filter(d => (d.data().message ?? '').includes(needle))) {
  const e = d.data()
  if (e.uid && !users.has(e.uid)) {
    const u = await db.doc(`users/${e.uid}`).get()
    users.set(e.uid, u.exists ? `${u.data().displayName ?? u.data().name ?? '?'} (${u.data().role}, cohort ${u.data().cohortId ?? '-'})` : 'unknown')
  }
  console.log(e.ts?.toDate().toISOString(), e.url?.replace(/^https?:\/\/[^/]+/, ''), '|', users.get(e.uid) ?? 'signed out', '|', (e.ua ?? '').slice(13, 50))
  console.log('   ', (e.stack ?? '').split('\n').slice(0, 8).join(' / ').slice(0, 600))
}
process.exit(0)
