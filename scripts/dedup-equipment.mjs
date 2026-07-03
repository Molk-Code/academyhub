/**
 * Deduplicates the `equipment` Firestore collection.
 * Groups documents by name (case-insensitive). For each group with more than
 * one document, keeps the oldest (lowest createdAt / smallest Firestore doc ID
 * as tiebreaker) and deletes the rest.
 *
 * Run: node scripts/dedup-equipment.mjs
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

async function main() {
  const snap = await db.collection('equipment').get()
  console.log(`Total equipment documents: ${snap.size}`)

  // Group by normalised name
  const groups = new Map()
  for (const d of snap.docs) {
    const key = (d.data().name ?? '').trim().toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(d)
  }

  const dupeGroups = [...groups.values()].filter(g => g.length > 1)
  if (dupeGroups.length === 0) {
    console.log('No duplicates found — nothing to do.')
    return
  }

  console.log(`Found ${dupeGroups.length} duplicate groups. Cleaning up…`)

  let deleted = 0
  const batch = db.batch()

  for (const group of dupeGroups) {
    // Sort: prefer doc with the most fields filled in (longest JSON), else oldest doc ID
    group.sort((a, b) => {
      const aScore = JSON.stringify(a.data()).length
      const bScore = JSON.stringify(b.data()).length
      if (bScore !== aScore) return bScore - aScore // richer doc first
      return a.id < b.id ? -1 : 1                  // older ID first as tiebreaker
    })

    const [keep, ...remove] = group
    console.log(`  Keep "${keep.data().name}" (${keep.id}), deleting ${remove.length} duplicate(s)`)
    for (const d of remove) {
      batch.delete(d.ref)
      deleted++
    }
  }

  await batch.commit()
  console.log(`Done — deleted ${deleted} duplicate document(s).`)
}

main().catch(err => { console.error(err); process.exit(1) })
