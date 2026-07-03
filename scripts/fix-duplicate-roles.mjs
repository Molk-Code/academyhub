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

const rolesSnap = await db.collection('crew_roles').orderBy('name').get()
const seen = new Map()
let deleted = 0
for (const doc of rolesSnap.docs) {
  const name = doc.data().name?.toLowerCase()
  if (seen.has(name)) {
    await doc.ref.delete()
    console.log(`Deleted duplicate: ${doc.data().name}`)
    deleted++
  } else {
    seen.set(name, doc.id)
  }
}
console.log(`Deleted ${deleted} duplicate crew roles`)
process.exit(0)
