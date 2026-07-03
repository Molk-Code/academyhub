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

const snap = await db.collection('absence_reports').get()
console.log(`Found ${snap.size} absence reports:`)
snap.docs.forEach(d => {
  const data = d.data()
  console.log(`  ${d.id}: student=${data.studentId}, date=${data.date}, status=${data.status}, lessonId=${data.lessonId}`)
})

const cutoff = new Date('2025-08-18')
let deleted = 0
for (const doc of snap.docs) {
  const created = doc.data().createdAt?.toDate?.()
  const absenceDate = doc.data().date ? new Date(doc.data().date) : null
  if ((created && created < cutoff) || (absenceDate && absenceDate < cutoff)) {
    await doc.ref.delete()
    console.log(`Deleted test absence: ${doc.id}`)
    deleted++
  }
}
console.log(`\nDeleted ${deleted} test absence reports`)
process.exit(0)
