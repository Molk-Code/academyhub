import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import admin from 'firebase-admin'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'serviceAccountKey.json'), 'utf8'))

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

// --- CSV parser (handles quoted fields with commas) ---
function parseCSV(text) {
  const lines = []
  const rows = text.split('\n')
  for (const row of rows) {
    const cols = []
    let inQuote = false
    let cur = ''
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch === '"') {
        inQuote = !inQuote
      } else if (ch === ',' && !inQuote) {
        cols.push(cur.trim())
        cur = ''
      } else {
        cur += ch
      }
    }
    cols.push(cur.trim())
    lines.push(cols)
  }
  return lines
}

function parsePrice(s) {
  if (!s) return 0
  const n = parseInt(s.replace(/\s/g, '').replace('kr', ''), 10)
  return isNaN(n) ? 0 : n
}

// Strip " #N" suffix for grouping (and trailing parens on numbered items)
function getBaseName(name) {
  if (!/ #\d+/.test(name)) return name
  let base = name.replace(/ #\d+( )/, '$1').replace(/ #\d+$/, '').trim()
  base = base.replace(/\s*\(.*\)\s*$/, '').trim()
  return base
}

// --- Main ---
const csv = readFileSync('/Users/fredrikfridlund/Downloads/Equipment - Equipment.csv', 'utf8')
const rows = parseCSV(csv)

const CATEGORY_MAP = {
  'CAMERA': 'CAMERA',
  'GRIP': 'GRIP',
  'LIGHTS': 'LIGHTS',
  'SOUND': 'SOUND',
  'Sound': 'SOUND',
  'LOCATION': 'LOCATION',
  'BOOKS': 'BOOKS',
  'OTHER': 'OTHER',
}

let currentCategory = 'OTHER'

// First pass: collect all individual items
const rawItems = []
for (const row of rows) {
  const categoryCell = row[1] ?? ''
  const restricted   = row[2] ?? ''
  const itemName     = row[3] ?? ''
  const dayRate      = row[5] ?? ''
  const weeklyRate   = row[6] ?? ''
  const included     = row[7] ?? ''
  const notes        = row[8] ?? ''

  if (CATEGORY_MAP[categoryCell]) {
    currentCategory = CATEGORY_MAP[categoryCell]
    continue
  }

  if (!itemName) continue

  rawItems.push({
    name:          itemName,
    category:      currentCategory,
    filmYear2Only: restricted === 'Film Year 2',
    dayRate:       parsePrice(dayRate),
    weeklyRate:    parsePrice(weeklyRate),
    included:      included ? included.split(',').map(s => s.trim()).filter(Boolean) : [],
    notes,
  })
}

// Second pass: group by base name (collapse #1, #2, ... into single entry)
const grouped = new Map() // baseName -> { data, count }

for (const item of rawItems) {
  const base = getBaseName(item.name)
  if (!grouped.has(base)) {
    grouped.set(base, { ...item, name: base, totalQuantity: 1 })
  } else {
    grouped.get(base).totalQuantity++
  }
}

const items = Array.from(grouped.values())

console.log(`\nParsed ${rawItems.length} rows → ${items.length} unique catalog items\n`)

// Group by category for logging
const byCat = {}
for (const item of items) {
  byCat[item.category] = (byCat[item.category] || 0) + 1
}
console.log('By category:', byCat, '\n')

// Write to Firestore
let written = 0
const batch = db.batch()

for (const item of items) {
  const ref = db.collection('equipment').doc()
  batch.set(ref, {
    name:          item.name,
    category:      item.category,
    description:   '',
    notes:         item.notes,
    location:      '',
    priceExclVat:  item.dayRate,
    priceInclVat:  item.dayRate,
    available:     item.totalQuantity,
    totalQuantity: item.totalQuantity,
    imageUrl:      '',
    qrCode:        '',
    included:      item.included,
    filmYear2Only: item.filmYear2Only,
    isActive:      true,
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
  })
  written++
  if (written % 20 === 0) {
    console.log(`  Queued ${written}/${items.length}...`)
  }
}

await batch.commit()
console.log(`\n✅ Successfully wrote ${written} equipment items to Firestore`)
process.exit(0)
