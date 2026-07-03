import { readFileSync, readdirSync } from 'fs'
import { join, extname, basename } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import admin from 'firebase-admin'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'serviceAccountKey.json'), 'utf8'))

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const CLOUD_NAME   = 'dpueywk51'
const UPLOAD_PRESET = 'academyhub_videos'
const IMAGE_DIR    = '/Users/fredrikfridlund/Downloads/Equipment bilder'

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

// Get base name from filename (strip extension, handle double-extension like .jpg.jpg)
function getBaseName(filename) {
  let name = filename
  // Strip known image extensions (possibly twice for .jpg.jpg case)
  for (let i = 0; i < 2; i++) {
    const ext = extname(name).toLowerCase()
    if (MIME[ext]) name = name.slice(0, -ext.length)
  }
  return name.trim()
}

// Generate candidate names from image base name to try matching against Firestore
function getCandidates(baseName) {
  const candidates = [baseName]
  // _ → / (e.g. "Microphone_Blimp kit" → "Microphone/Blimp kit")
  if (baseName.includes('_')) {
    candidates.push(baseName.replace(/_/g, '/'))
    candidates.push(baseName.replace(/_/g, '"'))
    candidates.push(baseName.replace(/_/g, "'"))
  }
  // "Vest" → also try "Vest kit"
  return candidates
}

function normalize(s) { return s.toLowerCase().trim() }

function findMatch(imageName, docs) {
  const candidates = getCandidates(imageName)

  for (const candidate of candidates) {
    const norm = normalize(candidate)
    // 1. Exact match
    const exact = docs.find(d => normalize(d.name) === norm)
    if (exact) return exact

    // 2. Doc name starts with image base (e.g. "Bmpcc 6k" → "Bmpcc 6k - Kit")
    const prefixMatch = docs.find(d => normalize(d.name).startsWith(norm + ' ') || normalize(d.name).startsWith(norm + '-'))
    if (prefixMatch) return prefixMatch

    // 3. Image base starts with doc name (e.g. "Sony F55 Kit" → "Sony F55")
    const revPrefix = docs.find(d => norm.startsWith(normalize(d.name) + ' '))
    if (revPrefix) return revPrefix

    // 4. Doc name contains image base
    const contains = docs.find(d => normalize(d.name).includes(norm))
    if (contains) return contains
  }
  return null
}

async function uploadToCloudinary(filePath, publicId) {
  const ext = extname(filePath).toLowerCase()
  const mimeType = MIME[ext] || 'image/jpeg'
  const fileData = readFileSync(filePath)
  const blob = new Blob([fileData], { type: mimeType })

  const form = new FormData()
  form.append('file', blob, basename(filePath))
  form.append('upload_preset', UPLOAD_PRESET)
  form.append('public_id', publicId)
  form.append('folder', 'equipment')

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Cloudinary upload failed (${res.status}): ${text}`)
  }
  const data = await res.json()
  return data.secure_url
}

async function main() {
  // Load all equipment docs
  const snap = await db.collection('equipment').get()
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`Loaded ${docs.length} equipment documents from Firestore\n`)

  // List image files
  const files = readdirSync(IMAGE_DIR).filter(f => MIME[extname(f).toLowerCase()] && f !== 'manifest.json')
  console.log(`Found ${files.length} image files\n`)

  let matched = 0
  let skipped = 0
  let failed = 0

  for (const filename of files) {
    const baseName = getBaseName(filename)
    const doc = findMatch(baseName, docs)

    if (!doc) {
      console.log(`  ⚠️  No match: "${baseName}"`)
      skipped++
      continue
    }

    // Skip if already has an image
    if (doc.imageUrl) {
      console.log(`  ⏭  Already has image: "${doc.name}"`)
      matched++
      continue
    }

    const publicId = baseName.replace(/[^a-zA-Z0-9\-_]/g, '_').toLowerCase()
    const filePath = join(IMAGE_DIR, filename)

    try {
      const url = await uploadToCloudinary(filePath, publicId)
      await db.collection('equipment').doc(doc.id).update({ imageUrl: url, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
      console.log(`  ✅  "${doc.name}" → ${url.slice(0, 80)}...`)
      matched++
      // small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 150))
    } catch (err) {
      console.error(`  ❌  Failed "${baseName}": ${err.message}`)
      failed++
    }
  }

  console.log(`\n--- Summary ---`)
  console.log(`Matched & uploaded: ${matched}`)
  console.log(`No match found:     ${skipped}`)
  console.log(`Upload errors:      ${failed}`)
  process.exit(0)
}

main()
