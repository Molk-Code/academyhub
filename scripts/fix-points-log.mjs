// One-off repair of points_log entries written before the jobs refactor:
//
//  1. Absence penalties were logged as { delta, awardedAt } instead of
//     { points, createdAt }. The points history orders by createdAt, so
//     students never saw them. Adds points/createdAt (keeps the old fields).
//  2. Check-in awards had referenceId = the student's uid instead of the
//     lesson id, so attendance stats never matched them. Finds the lesson from
//     the student's attendance doc checked in at the same time.
//
// totalPoints is not touched: the deductions and awards themselves were made.
// Lists what it would change unless --apply is given.
//
//   node scripts/fix-points-log.mjs            (dry run)
//   node scripts/fix-points-log.mjs --apply
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-cineforge node scripts/fix-points-log.mjs
import admin from 'firebase-admin'
import { readFileSync } from 'fs'

const apply = process.argv.includes('--apply')
if (process.env.FIRESTORE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-cineforge' })
} else {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))),
  })
}
const db = admin.firestore()

const log = await db.collection('points_log').get()

// 1. Penalties with the old field names
const penalties = log.docs.filter(d => {
  const x = d.data()
  return x.reason === 'absence_penalty' && x.points === undefined && typeof x.delta === 'number'
})

// 2. Check-ins pointing at the student instead of the lesson
const checkIns = log.docs.filter(d => {
  const x = d.data()
  return x.reason === 'attendance' && x.referenceId && x.referenceId === x.studentId
})
const attendance = checkIns.length ? (await db.collectionGroup('attendance').get()).docs
  .filter(a => a.ref.parent.parent?.parent.id === 'lessons')
  .map(a => ({ studentId: a.id, lessonId: a.ref.parent.parent.id, at: a.data().checkedInAt?.toMillis?.() ?? 0 })) : []

const lessonFor = (studentId, createdAt) => {
  const near = attendance
    .filter(a => a.studentId === studentId && Math.abs(a.at - createdAt) < 5 * 60_000)
    .sort((a, b) => Math.abs(a.at - createdAt) - Math.abs(b.at - createdAt))
  return near[0]?.lessonId ?? null
}

const bulk = apply ? db.bulkWriter() : null
let fixedPenalties = 0, fixedCheckIns = 0, unmatched = 0

for (const d of penalties) {
  const x = d.data()
  bulk?.update(d.ref, { points: x.delta, createdAt: x.awardedAt ?? admin.firestore.FieldValue.serverTimestamp(), awardedBy: null })
  fixedPenalties++
}
for (const d of checkIns) {
  const x = d.data()
  const lessonId = lessonFor(x.studentId, x.createdAt?.toMillis?.() ?? 0)
  if (!lessonId) { unmatched++; continue }
  bulk?.update(d.ref, { referenceId: lessonId })
  fixedCheckIns++
}
await bulk?.close()

console.log(`${apply ? 'fixed' : 'would fix'}: ${fixedPenalties} absence penalties, ${fixedCheckIns} check-in awards`
  + (unmatched ? ` (${unmatched} check-ins with no matching attendance record left as they are)` : ''))
if (!apply) console.log('dry run — nothing written; add --apply to write')
