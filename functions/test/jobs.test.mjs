// Scheduled jobs (jobs.ts, absence penalties, reminders) against the Firestore
// emulator: same result when run twice, dry run writes no points.
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db, admin } = await import('../lib/lib.js')
const { stockholmDate, stockholmTime, stockholmDayBounds, claimOnce, writePoints, pointsLogId } = await import('../lib/jobs.js')
const { planAbsencePenalties, runAbsencePenalties } = await import('../lib/points.js')
const { runEventReminders, reminderWindow } = await import('../lib/notifications-scheduled.js')

const ts = d => admin.firestore.Timestamp.fromDate(d)
const points = async uid => (await db.collection('users').doc(uid).get()).data().totalPoints

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
})

test('Swedish dates and times, summer and winter', () => {
  // 23:30 UTC on 11 Nov is already 12 Nov in Sweden (UTC+1)
  assert.equal(stockholmDate(new Date('2026-11-11T23:30:00Z')), '2026-11-12')
  assert.equal(stockholmTime(new Date('2026-07-01T06:45:00Z')), '08:45')   // UTC+2
  assert.equal(stockholmTime(new Date('2026-11-12T07:45:00Z')), '08:45')   // UTC+1
  const winter = stockholmDayBounds(new Date('2026-11-12T12:00:00Z'))
  assert.equal(winter.start.toISOString(), '2026-11-11T23:00:00.000Z')
  assert.equal(winter.end.toISOString(), '2026-11-12T23:00:00.000Z')
  const summer = stockholmDayBounds(new Date('2026-07-01T12:00:00Z'))
  assert.equal(summer.start.toISOString(), '2026-06-30T22:00:00.000Z')
  // The day the clocks go back is 25 hours long
  const dst = stockholmDayBounds(new Date('2026-10-25T12:00:00Z'))
  assert.equal(dst.end.getTime() - dst.start.getTime(), 25 * 3600_000)
})

test('planAbsencePenalties: who is penalised', () => {
  const lessonEnd = new Date('2026-11-12T10:00:00Z')
  const plan = planAbsencePenalties({
    lessonId: 'L', lessonEnd, lessonDate: '2026-11-12', penalty: -5,
    students: [
      { id: 'present' }, { id: 'absent' }, { id: 'fullDay' }, { id: 'thisLesson' }, { id: 'otherLesson' },
      { id: 'otherDay' }, { id: 'inactive', isActive: false },
      { id: 'joinedLater', enrolledAt: new Date('2026-11-12T12:00:00Z') },
    ],
    checkedInIds: new Set(['present']),
    absences: [
      { studentId: 'fullDay', type: 'full_day', date: '2026-11-12' },
      { studentId: 'thisLesson', type: 'lesson', lessonId: 'L', date: '2026-11-12' },
      { studentId: 'otherLesson', type: 'lesson', lessonId: 'X', date: '2026-11-12' },
      { studentId: 'otherDay', type: 'full_day', date: '2026-11-11' },
    ],
  })
  assert.deepEqual(plan, ['absent', 'otherLesson', 'otherDay'])
  assert.deepEqual(planAbsencePenalties({ lessonId: 'L', lessonEnd, lessonDate: '2026-11-12', penalty: 0,
    students: [{ id: 'absent' }], checkedInIds: new Set(), absences: [] }), [], 'a 0 penalty writes nothing')
})

test('claimOnce: true once per key', async () => {
  assert.equal(await claimOnce('k/1'), true)
  assert.equal(await claimOnce('k/1'), false)
  assert.equal(await claimOnce('k/2'), true)
})

test('writePoints: an award is written once; dry run writes nothing', async () => {
  await db.collection('users').doc('s1').set({ totalPoints: 10 })
  const e = { studentId: 's1', points: 3, reason: 'attendance', referenceId: 'L1' }

  const dry = await writePoints([e], { dryRun: true })
  assert.equal(dry.applied.length, 1)
  assert.equal(await points('s1'), 10)
  assert.equal((await db.collection('points_log').get()).size, 0)

  assert.equal((await writePoints([e])).applied.length, 1)
  assert.equal((await writePoints([e])).skipped.length, 1, 'second write is a no-op')
  await Promise.all([writePoints([e]), writePoints([e])])   // concurrent retries
  assert.equal(await points('s1'), 13)

  const log = (await db.collection('points_log').doc(pointsLogId(e)).get()).data()
  assert.equal(log.points, 3)
  assert.ok(log.createdAt, 'createdAt set, so the points history (ordered by it) lists it')
})

test('absence penalties: dry run, then real, then safe to run again', async () => {
  const now = new Date('2026-11-12T13:00:00Z')
  await db.collection('settings').doc('attendance').set({ absencePenalty: -5 })
  await db.collection('lessons').doc('L1').set({
    title: 'Editing', cohortId: 'c1',
    startTime: ts(new Date('2026-11-12T08:00:00Z')), endTime: ts(new Date('2026-11-12T10:00:00Z')),
  })
  for (const id of ['here', 'gone', 'excused'])
    await db.collection('users').doc(id).set({ role: 'student', cohortId: 'c1', isActive: true, totalPoints: 0 })
  await db.collection('lessons').doc('L1').collection('attendance').doc('here').set({ studentId: 'here' })
  await db.collection('absence_reports').add({ studentId: 'excused', cohortId: 'c1', type: 'full_day', date: '2026-11-12' })

  const dry = await runAbsencePenalties({ now, dryRun: true })
  assert.deepEqual(dry.entries, [{ lessonId: 'L1', studentId: 'gone', points: -5 }])
  assert.equal(await points('gone'), 0, 'dry run deducts nothing')
  assert.equal((await db.collection('points_log').get()).size, 0)
  const runs = (await db.collection('job_runs').get()).docs.map(d => d.data())
  assert.equal(runs.length, 1)
  assert.equal(runs[0].dryRun, true)
  assert.equal((await runAbsencePenalties({ now, dryRun: true })).lessons, 0, 'each lesson reported once')

  const real = await runAbsencePenalties({ now })
  assert.equal(real.applied, 1, 'a real run still applies a lesson the dry run saw')
  assert.equal(await points('gone'), -5)
  assert.equal(await points('here'), 0)
  assert.equal(await points('excused'), 0)
  const log = (await db.collection('points_log').get()).docs.map(d => d.data())
  assert.equal(log.length, 1)
  assert.equal(log[0].points, -5)
  assert.equal(log[0].reason, 'absence_penalty')
  assert.equal(log[0].referenceId, 'L1')
  assert.ok(log[0].createdAt)

  // A second run, or a retry that lost the "processed" mark, deducts nothing more
  assert.equal((await runAbsencePenalties({ now })).lessons, 0)
  await db.collection('lessons').doc('L1').update({ penaltiesAppliedAt: admin.firestore.FieldValue.delete() })
  const again = await runAbsencePenalties({ now })
  assert.equal(again.applied, 0)
  assert.equal(again.skipped, 1)
  assert.equal(await points('gone'), -5)
})

test('event reminders: each start announced once, a moved event again', async () => {
  const now = new Date('2026-11-12T07:30:00Z')
  const start = new Date(now.getTime() + 15 * 60_000)
  await db.collection('lessons').doc('L1').set({ title: 'Editing', cohortId: 'c1', startTime: ts(start), teacherIds: ['t1'] })
  await db.collection('personal_events').doc('P1').set({ title: 'Meeting', userId: 't1', startTime: ts(start) })

  assert.equal((await runEventReminders(now)).sent, 2)
  assert.equal((await runEventReminders(now)).sent, 0, 'retry of the same run')
  assert.equal((await runEventReminders(new Date(now.getTime() + 4 * 60_000))).sent, 0, 'next run, overlapping window')

  await db.collection('lessons').doc('L1').update({ startTime: ts(new Date(start.getTime() + 5 * 60_000)) })
  assert.equal((await runEventReminders(now)).sent, 1, 'moved lesson is announced at its new time')

  const w = reminderWindow(now)
  assert.ok(w.from < start && start < w.to)
})
