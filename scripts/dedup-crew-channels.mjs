// One-off: remove duplicate crew channels (createTeam/sync race) and channels
// left behind by deleted crews. Skips any channel that has messages.
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
initializeApp({ credential: cert(require('./serviceAccountKey.json')) })
const db = getFirestore()
const ids = ['QstkeOwMSiq1alyuA856','IAlWI0Rqda8YzhlWetmj','Whyfchq4e2oEsiXYnLbD',
  '7oHHNND4X1iLdglxqej5','NYcRpFkqp2TPqUVc5zJT','2CA7xAcZ9hYNTMLGgkAK','XVld6Mqj2KqaOkq2XJBG',
  'ao8FYISZFFWrHNQSkzFY','gmD0ofn7kevkbbsJAvB5','q6NCCQ21SsIJRmwkMDEb']
for (const id of ids) {
  const ref = db.collection('chat_channels').doc(id)
  const snap = await ref.get()
  if (!snap.exists) { console.log('already gone', id); continue }
  const n = (await ref.collection('messages').count().get()).data().count
  if (n > 0) { console.log('SKIP (has messages)', id, snap.data().name); continue }
  await ref.delete(); console.log('deleted', id, snap.data().name)
}
