// Diagnostic (read-only): inspect a subject by title and the teacher accounts' role claims.
// Usage: node scripts/diagnose-subject.mjs "Virtual Production"
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
initializeApp({ credential: cert(require('./serviceAccountKey.json')) })
const db = getFirestore()
const title = process.argv[2] ?? 'Virtual Production'
const snap = await db.collection('subjects').get()
for (const d of snap.docs.filter(d => (d.data().title ?? '').toLowerCase().includes(title.toLowerCase()))) {
  const s = d.data()
  const size = Buffer.byteLength(JSON.stringify(s))
  const undef = []
  const walk = (v, p) => { if (v === undefined) undef.push(p); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`) }
  walk(s, 'subject')
  console.log('subject', d.id, JSON.stringify(s.title), 'bytes', size, 'curriculum', (s.curriculum ?? []).length, 'resources', (s.resources ?? []).length,
    'keys', Object.keys(s).join(','), 'createdBy', s.createdBy, 'cohortIds', JSON.stringify(s.cohortIds), 'programYear', s.programYear)
  const teachers = await d.ref.collection('teachers').get()
  console.log('  subject teachers:', teachers.docs.map(t => `${t.data().name}(${t.data().userId ?? 'guest'})`).join(', ') || 'none')
}
const users = await db.collection('users').where('role', 'in', ['teacher', 'admin']).get()
for (const u of users.docs) {
  const d = u.data()
  let claims = {}
  try { claims = (await getAuth().getUser(u.id)).customClaims ?? {} } catch (e) { claims = { error: e.code } }
  console.log('user', d.displayName, '| role', d.role, '| roles', JSON.stringify(d.roles ?? null), '| claims', JSON.stringify(claims))
}
