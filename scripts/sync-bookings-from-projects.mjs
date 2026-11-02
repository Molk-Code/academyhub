// One-off: bring equipment booking requests in line with their inventory
// project (dates; closed once the project is archived/returned). New changes
// are kept in sync by the onInventoryProjectUpdated trigger.
// Usage: node scripts/sync-bookings-from-projects.mjs [--apply]
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))) })
const db = admin.firestore()
const apply = process.argv.includes('--apply')

const projects = await db.collection('inventory_projects').get()
let n = 0
for (const p of projects.docs) {
  const d = p.data()
  if (!d.bookingId) continue
  const ref = db.collection('equipment_bookings').doc(d.bookingId)
  const b = await ref.get()
  if (!b.exists) continue
  const bd = b.data()
  const update = {}
  if (bd.checkoutDate !== d.checkoutDate) update.checkoutDate = d.checkoutDate ?? ''
  if (bd.returnDate !== d.returnDate) update.returnDate = d.returnDate ?? ''
  if ((d.status === 'archived' || d.status === 'returned') && bd.status !== 'returned' && bd.status !== 'cancelled' && bd.status !== 'denied') {
    update.status = 'returned'
    update.closedByProject = true
  }
  if (!Object.keys(update).length) continue
  n++
  console.log(`${d.status.padEnd(9)} ${String(d.name).slice(0, 34).padEnd(34)} booking ${bd.status} → ${JSON.stringify(update)}`)
  if (apply) await ref.update(update)
}
console.log(apply ? `Updated ${n}` : `${n} to update (dry run — pass --apply)`)
process.exit(0)
