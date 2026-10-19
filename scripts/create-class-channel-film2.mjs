// One-off: Film 2 predates onCohortCreated, so give it its class channel.
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
initializeApp({ credential: cert(require('./serviceAccountKey.json')) })
const db = getFirestore()
const id = 'zC54HFHn49lT5pGvZD2E'
const ref = db.collection('chat_channels').doc(`class_${id}`)
await ref.create({
  name: 'film-2', description: 'Channel for Film 2', order: 50, isPublic: false,
  allowedRoles: [], allowedCohortIds: [id], allowedTeamIds: [], memberIds: [],
  createdAt: FieldValue.serverTimestamp(), createdBy: 'system',
})
console.log('created', (await ref.get()).data())
