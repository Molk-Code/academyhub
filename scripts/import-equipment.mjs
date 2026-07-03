import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, 'serviceAccountKey.json'))

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const raw = JSON.parse(readFileSync('/Users/fredrikfridlund/equipment-booking/src/data/equipment.json', 'utf-8'))
const items = Array.isArray(raw) ? raw : raw.equipment ?? raw.items ?? Object.values(raw)
console.log(`Found ${items.length} items to import`)

const existingSnap = await db.collection('equipment').get()
const existingNames = new Set(existingSnap.docs.map(d => d.data().name?.toLowerCase().trim()))
console.log(`${existingNames.size} items already in Firestore`)

let count = 0
let skipped = 0
const BATCH_SIZE = 400
let batch = db.batch()
let batchCount = 0

for (const item of items) {
  const name = (item.name ?? item.Name ?? item.title ?? '').trim()
  if (!name) { skipped++; continue }
  if (existingNames.has(name.toLowerCase())) { skipped++; continue }

  const ref = db.collection('equipment').doc()
  batch.set(ref, {
    name,
    category:      (item.category ?? item.Category ?? 'OTHER').toString().toUpperCase(),
    description:   item.description ?? item.Description ?? '',
    notes:         item.notes ?? item.Notes ?? '',
    location:      item.location ?? item.Location ?? '',
    totalQuantity: Math.max(1, Number(item.quantity ?? item.Quantity ?? item.stock ?? 1) || 1),
    available:     Math.max(1, Number(item.quantity ?? item.Quantity ?? item.stock ?? 1) || 1),
    priceExclVat:  Number(item.price ?? item.Price ?? item.priceExclVat ?? 0) || 0,
    priceInclVat:  Number(item.priceIncVat ?? item.priceInclVat ?? ((Number(item.price ?? 0) || 0) * 1.25)),
    imageUrl:      item.imageUrl ?? item.image ?? item.Image ?? '',
    included:      Array.isArray(item.included) ? item.included : [],
    filmYear2Only: item.filmYear2Only ?? item.year2only ?? false,
    isActive:      true,
    qrValue:       name,
    createdAt:     new Date(),
  })

  count++
  batchCount++

  if (batchCount >= BATCH_SIZE) {
    await batch.commit()
    console.log(`Committed ${count} items...`)
    batch = db.batch()
    batchCount = 0
  }
}

if (batchCount > 0) await batch.commit()
console.log(`\nDone — imported ${count} new items, skipped ${skipped}`)
process.exit(0)
