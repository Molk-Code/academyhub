import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const sa = require('./serviceAccountKey.json')
initializeApp({ credential: cert(sa) })
const db = getFirestore()
const snap = await db.collection('equipment').get()
console.log('Total items:', snap.size)
snap.docs.forEach(d => {
  const data = d.data()
  console.log(data.category.padEnd(10), '|', data.name.substring(0,40).padEnd(40), '| allowedCohortIds:', JSON.stringify(data.allowedCohortIds ?? []).substring(0,30), '| reqProd:', data.requiresProduction)
})
