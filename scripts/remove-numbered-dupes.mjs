/**
 * Removes equipment items that match the pattern "Name #N" (e.g. "Dedo Lights 3-kit #1")
 * AND have no picture (imageUrl is null / undefined / empty string).
 *
 * Run: node scripts/remove-numbered-dupes.mjs
 * Dry-run by default — pass --commit to actually delete.
 */

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

const commit = process.argv.includes('--commit')

async function main() {
  const snap = await db.collection('equipment').get()
  console.log(`Total equipment documents: ${snap.size}`)

  // Build a map of normalised-name → docs (for checking if a "parent" exists)
  const byName = new Map()
  for (const d of snap.docs) {
    const key = (d.data().name ?? '').trim().toLowerCase()
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(d)
  }

  const NUMBERED = /^(.+?)\s+#\d+$/i

  const toDelete = []

  for (const d of snap.docs) {
    const data = d.data()
    const name = (data.name ?? '').trim()
    const match = name.match(NUMBERED)
    if (!match) continue

    // Has a picture? Keep it.
    if (data.imageUrl) {
      console.log(`  SKIP  "${name}" — has an image, leaving it alone`)
      continue
    }

    // Check whether the base item exists (with or without a picture)
    const baseName = match[1].trim().toLowerCase()
    const baseExists = byName.has(baseName)

    if (baseExists) {
      const baseDoc = byName.get(baseName)[0]
      const baseHasImage = !!baseDoc.data().imageUrl
      console.log(`  ${commit ? 'DELETE' : 'WOULD DELETE'}  "${name}" (${d.id}) — base "${match[1]}" exists (image: ${baseHasImage})`)
      toDelete.push(d.ref)
    } else {
      console.log(`  SKIP  "${name}" — no base item found, leaving it alone`)
    }
  }

  if (toDelete.length === 0) {
    console.log('\nNothing to delete.')
    return
  }

  console.log(`\n${commit ? 'Deleting' : 'Would delete'} ${toDelete.length} item(s).`)

  if (!commit) {
    console.log('\nDry run — pass --commit to actually delete.')
    return
  }

  const batch = db.batch()
  for (const ref of toDelete) batch.delete(ref)
  await batch.commit()
  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
