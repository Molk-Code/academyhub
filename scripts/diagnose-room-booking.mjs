// Diagnostic (read-only): room booking state — rooms, settings, recent bookings, related bug reports.
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
initializeApp({ credential: cert(require('./serviceAccountKey.json')) })
const db = getFirestore()
const rooms = await db.collection('rooms').get()
rooms.docs.forEach(d => { const r = d.data(); console.log('room', d.id, r.name, 'active=' + r.isActive, JSON.stringify(r.availability)) })
for (const id of ['booking', 'semester']) console.log('settings/' + id, JSON.stringify((await db.collection('settings').doc(id).get()).data()))
const b = await db.collection('room_bookings').orderBy('createdAt', 'desc').limit(8).get()
b.docs.forEach(d => { const x = d.data(); console.log('booking', x.date, x.startTime, x.roomId, x.studentName, x.createdAt?.toDate().toISOString()) })
const bugs = await db.collection('bug_reports').orderBy('createdAt', 'desc').limit(10).get()
bugs.docs.forEach(d => { const x = d.data(); console.log('bug', x.createdAt?.toDate().toISOString(), x.displayName, '|', (x.description ?? '').slice(0, 140), '|', x.page ?? x.url ?? '') })
