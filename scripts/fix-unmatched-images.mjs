import { readFileSync, readdirSync } from 'fs'
import { join, extname, basename } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import admin from 'firebase-admin'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'serviceAccountKey.json'), 'utf8'))

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const CLOUD_NAME    = 'dpueywk51'
const UPLOAD_PRESET = 'academyhub_videos'
const IMAGE_DIR     = '/Users/fredrikfridlund/Downloads/Equipment bilder'
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }

// Only retry these
const UNMATCHED = [
  '(BOOK) Att skriva för film',
  '(BOOK) Börja Tala',
  '(BOOK) Dokumentärfilmarens resa – Reflektioner kring ett trettioårigt arbete',
  '(BOOK) Film Directing Shot by Shot - Visualizing from Concept to Screen',
  '(BOOK) Fotografera i Färg',
  '(BOOK) Jägarna - Från idé till succé',
  '(BOOK) Konst som rörlig bild',
  '(BOOK) Marknadsföring - Modeller och Principer',
  '(BOOK) Ordbok för filmare',
  '(BOOK) Så smalfilmar man',
  'Arri 150w Tungsten',
  'Atomos Shinobi 7_ Directors Monitor',
  'Hedén Carat Follow Focus',
  'Power Cable Nätkabel',
  'Røde Blimp w. Dead Cat',
  'Røde NTG-3 (Foam Windscreen)',
  'Seetec 15,6_ Monitor w. Case',
  'TV-Logic 7_ Field Monitor',
]

function getBaseName(filename) {
  let name = filename
  for (let i = 0; i < 2; i++) {
    const ext = extname(name).toLowerCase()
    if (MIME[ext]) name = name.slice(0, -ext.length)
  }
  return name.trim()
}

// NFC normalize + lowercase + collapse whitespace
function norm(s) {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function getCandidates(name) {
  const variants = [
    name,                             // original
    name.replace(/_/g, ' '),          // _ → space  (handles 7_ → 7 )
    name.replace(/_/g, '/'),          // _ → /
    name.replace(/_/g, '"'),          // _ → "
    name.replace(/_/g, "'"),          // _ → '
  ]
  return [...new Set(variants.map(v => norm(v)))]
}

function findMatch(imageName, docs) {
  const candidates = getCandidates(imageName)
  for (const candidate of candidates) {
    const exact = docs.find(d => norm(d.name) === candidate)
    if (exact) return exact
    const prefix = docs.find(d => norm(d.name).startsWith(candidate + ' '))
    if (prefix) return prefix
    const rev = docs.find(d => candidate.startsWith(norm(d.name) + ' '))
    if (rev) return rev
  }
  return null
}

async function uploadToCloudinary(filePath, publicId) {
  const ext = extname(filePath).toLowerCase()
  const mimeType = MIME[ext] || 'image/jpeg'
  const blob = new Blob([readFileSync(filePath)], { type: mimeType })
  const form = new FormData()
  form.append('file', blob, basename(filePath))
  form.append('upload_preset', UPLOAD_PRESET)
  form.append('public_id', publicId)
  form.append('folder', 'equipment')
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Cloudinary (${res.status}): ${await res.text()}`)
  return (await res.json()).secure_url
}

async function main() {
  const snap = await db.collection('equipment').get()
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`Loaded ${docs.length} equipment docs\n`)

  const files = readdirSync(IMAGE_DIR).filter(f => MIME[extname(f).toLowerCase()])

  for (const unmatchedBase of UNMATCHED) {
    // Find the actual file
    const file = files.find(f => getBaseName(f).normalize('NFC') === unmatchedBase.normalize('NFC')
                                || getBaseName(f) === unmatchedBase)
    if (!file) { console.log(`  📁 File not found in folder: "${unmatchedBase}"`); continue }

    const doc = findMatch(unmatchedBase, docs)
    if (!doc) { console.log(`  ⚠️  Still no Firestore match: "${unmatchedBase}"`); continue }
    if (doc.imageUrl) { console.log(`  ⏭  Already has image: "${doc.name}"`); continue }

    const publicId = unmatchedBase.normalize('NFC').replace(/[^a-zA-Z0-9\-_]/g, '_').toLowerCase()
    try {
      const url = await uploadToCloudinary(join(IMAGE_DIR, file), publicId)
      await db.collection('equipment').doc(doc.id).update({ imageUrl: url, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
      console.log(`  ✅  "${doc.name}"`)
      await new Promise(r => setTimeout(r, 150))
    } catch (err) {
      console.error(`  ❌  "${unmatchedBase}": ${err.message}`)
    }
  }
  console.log('\nDone.')
  process.exit(0)
}

main()
