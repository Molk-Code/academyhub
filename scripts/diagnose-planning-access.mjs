// Read-only: a production planning doc + whether a given user is a member.
// Usage: node scripts/diagnose-planning-access.mjs <docId> "<user name>"
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))) })
const db = admin.firestore()
const [id, name] = process.argv.slice(2)
const users = (await db.collection('users').get()).docs.filter(d => (d.data().displayName ?? '').toLowerCase().includes(name.toLowerCase()))
for (const u of users) console.log('user', u.id, u.data().displayName, u.data().role, u.data().cohortId)
for (const col of ['productions', 'production_teams', 'production_plans', 'planning']) {
  const d = await db.collection(col).doc(id).get()
  if (d.exists) { const x = d.data(); console.log(col, id, JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k, v]) => typeof v !== 'object' || Array.isArray(v)))).slice(0, 1200)); for (const sub of await d.ref.listCollections()) console.log('  sub', sub.id, (await sub.count().get()).data().count) }
}
process.exit(0)
