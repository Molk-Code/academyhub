// One-off: set every catalog item's "available" to its total minus the units
// out in projects (checked out, damaged or missing) — the same rule the
// onInventoryItemWritten function keeps from now on.
// Usage: node scripts/resync-equipment-available.mjs [--apply]
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))) })
const db = admin.firestore()
const apply = process.argv.includes('--apply')

const OUT_STATUSES = ['checked-out', 'damaged', 'missing']
const out = {}
for (const i of (await db.collectionGroup('items').get()).docs) {
  if (i.ref.parent.parent?.parent.id !== 'inventory_projects') continue
  const x = i.data()
  if (x.equipmentId && OUT_STATUSES.includes(x.status)) out[x.equipmentId] = (out[x.equipmentId] ?? 0) + 1
}
let n = 0
for (const d of (await db.collection('equipment').get()).docs) {
  const e = d.data()
  const available = Math.max(0, Number(e.totalQuantity ?? 0) - (out[d.id] ?? 0))
  if (e.available === available) continue
  n++
  console.log(`${e.name}: ${e.available} → ${available} of ${e.totalQuantity}`)
  if (apply) await d.ref.update({ available })
}
console.log(apply ? `Updated ${n}` : `${n} to update (dry run — add --apply)`)
