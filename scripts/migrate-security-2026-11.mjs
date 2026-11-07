// One-off migration for the November 2026 security fixes.
//
//   node scripts/migrate-security-2026-11.mjs            # copy only (safe to re-run)
//   node scripts/migrate-security-2026-11.mjs --finish   # copy, then remove the old fields
//
// 1. Push tokens: users/{uid}.fcmTokens → push_tokens/{uid}.tokens
//    (--finish also deletes users/{uid}.fcmTokens, which every signed-in user can list)
// 2. QR displays: give every device a secret link key and clear the token
//    from its public doc
// 3. Room display: backfill room_slots for bookings from today onward
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { randomBytes } from 'crypto'

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))),
})
const db = admin.firestore()
const finish = process.argv.includes('--finish')
const { FieldValue } = admin.firestore

// 1 ── push tokens
const users = await db.collection('users').get()
let copied = 0, cleared = 0
let bulk = db.bulkWriter()
for (const d of users.docs) {
  const tokens = (d.data().fcmTokens ?? []).filter(Boolean)
  if (tokens.length) {
    bulk.set(db.collection('push_tokens').doc(d.id), { tokens: FieldValue.arrayUnion(...tokens) }, { merge: true })
    copied++
  }
  if (finish && 'fcmTokens' in d.data()) {
    bulk.update(d.ref, { fcmTokens: FieldValue.delete() })
    cleared++
  }
}
await bulk.close()
console.log(`push tokens: copied for ${copied} users${finish ? `, removed from ${cleared} user docs` : ''}`)

// 2 ── QR display keys
const devices = await db.collection('qr_display_devices').get()
let keyed = 0
for (const d of devices.docs) {
  const cfgRef = d.ref.collection('private').doc('config')
  if (!(await cfgRef.get()).exists) {
    await cfgRef.set({ displayKey: randomBytes(24).toString('base64url') })
    keyed++
  }
  if (d.data().activeToken) await d.ref.update({ activeToken: null })
}
console.log(`qr displays: ${devices.size} total, ${keyed} given a secure link key`)

// 3 ── room_slots backfill (mirrors functions/src/calendar.ts roomSlotFrom)
const today = new Date().toISOString().slice(0, 10)
const bookings = await db.collection('room_bookings').where('date', '>=', today).get()
bulk = db.bulkWriter()
for (const d of bookings.docs) {
  const b = d.data()
  bulk.set(db.collection('room_slots').doc(d.id), {
    roomId:      b.roomId ?? null,
    blockId:     b.blockId ?? null,
    date:        b.date ?? null,
    startTime:   b.startTime ?? null,
    endTime:     b.endTime ?? null,
    studentName: String(b.studentName ?? '').trim().split(/\s+/)[0] ?? '',
  })
}
await bulk.close()
console.log(`room slots: ${bookings.size} upcoming bookings mirrored`)
