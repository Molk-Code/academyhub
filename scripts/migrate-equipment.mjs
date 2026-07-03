// Run with: node scripts/migrate-equipment.mjs
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const serviceAccount = require('./serviceAccountKey.json')

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// 1. All BOOKS items → requiresProduction: false
const equipSnap = await db.collection('equipment').get()
const cohortSnap = await db.collection('cohorts').get()

const film2CohortIds = cohortSnap.docs
  .filter(d => d.data().programYear === 2)
  .map(d => d.id)

console.log('Film 2 cohort IDs:', film2CohortIds)

let booksBatch = db.batch()
let booksCount = 0
let year2Batch = db.batch()
let year2Count = 0

for (const doc of equipSnap.docs) {
  const data = doc.data()

  if (data.category === 'BOOKS' && data.requiresProduction !== false) {
    booksBatch.update(doc.ref, { requiresProduction: false })
    booksCount++
    console.log(`  BOOKS: ${data.name}`)
  }

  if (
    data.name?.toLowerCase().includes('year 2') &&
    (!data.allowedCohortIds || data.allowedCohortIds.length === 0) &&
    film2CohortIds.length > 0
  ) {
    year2Batch.update(doc.ref, { allowedCohortIds: film2CohortIds, filmYear2Only: false })
    year2Count++
    console.log(`  Year 2: ${data.name}`)
  }
}

if (booksCount > 0) {
  await booksBatch.commit()
  console.log(`\n✓ Set ${booksCount} Books item(s) to requiresProduction: false`)
} else {
  console.log('\n✓ No Books items needed updating')
}

if (year2Count > 0) {
  await year2Batch.commit()
  console.log(`✓ Set ${year2Count} Year 2 item(s) to Film 2 cohorts`)
} else {
  console.log('✓ No Year 2 items needed updating')
}
