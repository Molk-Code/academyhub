// Class rollover and "copy last year's plan" against the Firestore emulator.
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db, admin } = await import('../lib/lib.js')
const { runRollover, planCopy } = await import('../lib/class-admin.js')

const ts = d => admin.firestore.Timestamp.fromDate(new Date(d))
const get = async (col, id) => (await db.collection(col).doc(id).get()).data()

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
})

async function seedClass() {
  await db.collection('cohorts').doc('film1').set({
    name: 'Film 2025', programYear: 1, teacherIds: ['t1'], studentIds: ['s1', 's2', 's3'], color: '#f00',
    startDate: ts('2025-08-18'), endDate: ts('2026-06-12'),
  })
  for (const id of ['s1', 's2', 's3']) await db.collection('users').doc(id).set({ role: 'student', cohortId: 'film1', isActive: true })
  await db.collection('invitations').doc('i1').set({ email: 'new@x.se', cohortId: 'film1', used: false })
  await db.collection('invitations').doc('i2').set({ email: 'old@x.se', cohortId: 'film1', used: true })
  await db.collection('classInvites').doc('q1').set({ cohortId: 'film1', active: true })
  await db.collection('users').doc('other').set({ role: 'student', cohortId: 'elsewhere', isActive: true })
}

test('rollover: new class, chosen students move, old class archived; only once', async () => {
  await seedClass()
  const r = await runRollover('admin1', {
    cohortId: 'film1',
    moveStudentIds: ['s1', 's2', 'other'],            // 'other' isn't in the class: skipped
    next: { name: 'Film 2025 – year 2', startDate: '2026-08-17', endDate: '2027-06-11', programYear: 2, semesterStartDate: '2026-08-17' },
  })
  assert.equal(r.moved, 2)
  assert.equal(r.skipped, 1)
  const next = await get('cohorts', r.nextCohortId)
  assert.equal(next.name, 'Film 2025 – year 2')
  assert.equal(next.programYear, 2)
  assert.deepEqual(next.teacherIds, ['t1'])
  assert.deepEqual(next.studentIds.sort(), ['s1', 's2'])
  assert.equal(next.previousCohortId, 'film1')
  assert.equal(next.semesterStartDate, '2026-08-17')
  assert.equal((await get('users', 's1')).cohortId, r.nextCohortId)
  assert.equal((await get('users', 's3')).cohortId, 'film1', 'not chosen: stays')
  assert.equal((await get('users', 'other')).cohortId, 'elsewhere')
  const old = await get('cohorts', 'film1')
  assert.equal(old.archived, true)
  assert.equal(old.nextCohortId, r.nextCohortId)
  assert.deepEqual(old.studentIds, ['s1', 's2', 's3'], 'roster kept for history')

  assert.equal((await get('invitations', 'i1')).cohortId, r.nextCohortId, 'pending invite follows the class')
  assert.equal((await get('invitations', 'i2')).cohortId, 'film1', 'used invite untouched')
  assert.equal((await get('classInvites', 'q1')).active, false, 'QR sign-up closed')
  await assert.rejects(runRollover('admin1', { cohortId: 'film1' }), /already been archived/)
  assert.equal((await db.collection('cohorts').get()).size, 2)
})

test('rollover: a graduating class is archived and its students can be marked inactive', async () => {
  await seedClass()
  const r = await runRollover('admin1', { cohortId: 'film1', deactivateStudentIds: ['s1', 's2', 's3'] })
  assert.equal(r.nextCohortId, null)
  assert.equal(r.deactivated, 3)
  assert.equal((await get('users', 's2')).isActive, false)
  assert.equal((await get('cohorts', 'film1')).archived, true)
})

test('rollover: invalid input changes nothing', async () => {
  await seedClass()
  await assert.rejects(runRollover('admin1', { cohortId: 'film1', moveStudentIds: ['s1'] }), /next class/)
  await assert.rejects(runRollover('admin1', { cohortId: 'film1', next: { name: 'X2', startDate: '2026-08-17', endDate: '2026-01-01' } }), /end date/)
  assert.equal((await get('cohorts', 'film1')).archived, undefined)
})

test('copy plan: lessons and assignments shifted by whole weeks, subjects shared, safe to repeat', async () => {
  await db.collection('cohorts').doc('old').set({ name: 'Film 2025', teacherIds: ['t1'] })
  await db.collection('cohorts').doc('new').set({ name: 'Film 2026', teacherIds: ['t1'] })
  // Monday 1 Sep 2025, 09:00 Stockholm
  await db.collection('lessons').doc('L1').set({
    cohortId: 'old', subjectId: 'sub1', title: 'Editing basics', description: 'd', teacherId: 't1', teacherIds: ['t1'],
    guestTeacherIds: ['g1'], classroom: 'A1', isOnline: false, resources: [{ type: 'link', url: 'x' }],
    startTime: ts('2025-09-01T07:00:00Z'), endTime: ts('2025-09-01T09:00:00Z'), penaltiesAppliedAt: ts('2025-09-01T10:00:00Z'),
  })
  await db.collection('lessons').doc('L2').set({ cohortId: 'old', subjectId: 'sub1', title: 'Outside period', startTime: ts('2026-08-01T07:00:00Z'), endTime: ts('2026-08-01T09:00:00Z') })
  await db.collection('lessons').doc('L3').set({ cohortId: 'other', subjectId: 'sub1', title: 'Other class', startTime: ts('2025-09-02T07:00:00Z'), endTime: ts('2025-09-02T09:00:00Z') })
  await db.collection('assignments').doc('A1').set({ cohortId: 'old', subjectId: 'sub1', title: 'Short film', isPublished: true, dueDate: ts('2025-10-03T21:59:00Z'), createdBy: 't0', pointsValue: 10 })
  await db.collection('subjects').doc('sub1').set({ name: 'Editing', cohortIds: ['old'] })
  await db.collection('subjects').doc('sub2').set({ name: 'Everyone', cohortIds: [] })

  const opts = { fromCohortId: 'old', toCohortId: 'new', from: new Date('2025-08-01T00:00:00Z'), to: new Date('2026-07-01T00:00:00Z'),
    shiftDays: 364, lessons: true, assignments: true, subjects: true, uid: 't1' }

  const dry = await planCopy({ ...opts, dryRun: true })
  assert.deepEqual(dry.lessons, { found: 1, toCopy: 1, alreadyCopied: 0 })
  assert.deepEqual(dry.assignments, { found: 1, toCopy: 1, alreadyCopied: 0 })
  assert.equal(dry.subjects, 1)
  assert.equal(dry.sample[0].to, '2026-08-31T07:00:00.000Z', 'Monday stays Monday')
  assert.equal((await db.collection('lessons').get()).size, 3, 'dry run writes nothing')

  await planCopy({ ...opts, dryRun: false })
  const l = await get('lessons', 'copy_L1_new')
  assert.equal(l.cohortId, 'new')
  assert.equal(l.title, 'Editing basics')
  assert.equal(l.startTime.toDate().toISOString(), '2026-08-31T07:00:00.000Z')
  assert.equal(l.startTime.toDate().getUTCDay(), 1)
  assert.equal(l.penaltiesAppliedAt, undefined)
  assert.equal(l.guestTeacherIds, undefined)
  assert.deepEqual(l.copiedFrom, { lessonId: 'L1', cohortId: 'old' })
  const a = await get('assignments', 'copy_A1_new')
  assert.equal(a.isPublished, false, 'copied assignments wait for review')
  assert.equal(a.createdBy, 't1')
  assert.equal(a.dueDate.toDate().toISOString(), '2026-10-02T21:59:00.000Z')
  assert.deepEqual((await get('subjects', 'sub1')).cohortIds, ['old', 'new'])
  assert.deepEqual((await get('subjects', 'sub2')).cohortIds, [])

  const again = await planCopy({ ...opts, dryRun: false })
  assert.deepEqual(again.lessons, { found: 1, toCopy: 0, alreadyCopied: 1 })
  assert.equal(again.subjects, 0)
  assert.equal((await db.collection('lessons').get()).size, 4)
})
