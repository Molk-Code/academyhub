// Automatic deletion of former students (retention.ts) against the Firestore emulator.
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db, admin } = await import('../lib/lib.js')
const { planRetention, runRetention } = await import('../lib/retention.js')

const NOW = Date.parse('2026-11-12T12:00:00Z')
const monthsAgo = m => NOW - m * 30.44 * 86_400_000
const ts = ms => admin.firestore.Timestamp.fromMillis(ms)
const exists = async (col, id) => (await db.collection(col).doc(id).get()).exists

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
})

test('planRetention: only students still in a class archived long enough ago', () => {
  const cohorts = [
    { id: 'old', name: 'Film 2024', archived: true, archivedAtMs: monthsAgo(13) },
    { id: 'recent', name: 'Film 2025', archived: true, archivedAtMs: monthsAgo(3) },
    { id: 'current', name: 'Film 2026', archived: false, archivedAtMs: null },
  ]
  const users = [
    { id: 'grad', role: 'student', cohortId: 'old', displayName: 'Grad' },
    { id: 'teacherToo', role: 'student', roles: ['student', 'teacher'], cohortId: 'old' },
    { id: 'staff', role: 'teacher', cohortId: 'old' },
    { id: 'recentGrad', role: 'student', cohortId: 'recent' },
    { id: 'moved', role: 'student', cohortId: 'current' },
  ]
  assert.deepEqual(planRetention({ cohorts, users, months: 12, now: NOW }),
    [{ uid: 'grad', displayName: 'Grad', cohortId: 'old', cohortName: 'Film 2024' }])
  assert.equal(planRetention({ cohorts, users, months: 2, now: NOW }).length, 2)
})

test('runRetention: off by default; dry run reports; real run erases like a self-delete', async () => {
  await db.collection('cohorts').doc('old').set({ name: 'Film 2024', archived: true, archivedAt: ts(monthsAgo(13)), studentIds: ['grad', 'moved'] })
  await db.collection('cohorts').doc('new').set({ name: 'Film 2025 – year 2', studentIds: ['moved'] })
  await db.collection('users').doc('grad').set({ role: 'student', cohortId: 'old', displayName: 'Grad' })
  await db.collection('users').doc('moved').set({ role: 'student', cohortId: 'new', displayName: 'Moved' })
  await db.collection('points_log').doc('p1').set({ studentId: 'grad', points: 5 })
  await db.collection('submissions').doc('s1').set({ studentId: 'grad' })
  await db.collection('development_plans').doc('grad').set({ goal: 'x' })

  const off = await runRetention({ now: NOW })
  assert.equal(off.enabled, false)
  assert.ok(await exists('users', 'grad'), 'nothing happens until the school turns it on')

  await db.collection('settings').doc('retention').set({ archivedClassMonths: 12 })
  const dry = await runRetention({ now: NOW, dryRun: true })
  assert.deepEqual(dry.due.map(d => d.uid), ['grad'])
  assert.ok(await exists('users', 'grad'), 'dry run deletes nothing')

  const real = await runRetention({ now: NOW })
  assert.equal(real.erased, 1)
  assert.deepEqual(real.failed, [])
  assert.equal(await exists('users', 'grad'), false)
  assert.equal(await exists('points_log', 'p1'), false)
  assert.equal(await exists('submissions', 's1'), false)
  assert.equal(await exists('development_plans', 'grad'), false)
  assert.ok(await exists('users', 'moved'), 'moved-on student untouched')
  const cohort = (await db.collection('cohorts').doc('old').get()).data()
  assert.deepEqual(cohort.studentIds, ['moved'])
  assert.ok(cohort.personalDataErasedAt)
  const log = (await db.collection('deletion_log').get()).docs.map(d => d.data())
  assert.equal(log.length, 1)
  assert.equal(log[0].uid, 'grad')
  assert.equal(log[0].deletedBy, 'system')
  assert.match(log[0].method, /^retention: 12 months after Film 2024/)

  assert.equal((await runRetention({ now: NOW })).due.length, 0, 'nothing left to do on the next run')
})
