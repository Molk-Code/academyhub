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

// Reset all users with negative totalPoints to 0
const usersSnap = await db.collection('users').get()
let fixed = 0
for (const doc of usersSnap.docs) {
  const pts = doc.data().totalPoints ?? 0
  if (pts < 0) {
    await doc.ref.update({ totalPoints: 0 })
    console.log(`Reset ${doc.data().displayName}: ${pts} → 0`)
    fixed++
  }
}

// Delete all negative points_log entries
const logsSnap = await db.collection('points_log').where('points', '<', 0).get()
for (const doc of logsSnap.docs) {
  await doc.ref.delete()
}

console.log(`Fixed ${fixed} users, deleted ${logsSnap.size} negative log entries`)
process.exit(0)
