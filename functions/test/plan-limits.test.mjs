// Plan limits and plan features: the helpers in pricing.ts, the counting in
// usage.ts and the checks in firestore.rules, against the Firestore emulator:
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')
const DOCS = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`

const { db } = await import('../lib/lib.js')
const pricing = await import('../lib/pricing.js')
const usage = await import('../lib/usage.js')

function token(uid, role, email = `${uid}@example.test`) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const t = Math.floor(Date.now() / 1000)
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid,
    iat: t, exp: t + 3600, auth_time: t, ...(role ? { role } : {}), email_verified: true, email,
    firebase: { sign_in_provider: 'password' },
  })}.`
}
const ADMIN = token('emu-admin', 'admin')
const str = v => ({ stringValue: v })
const bool = v => ({ booleanValue: v })

async function call(method, path, bearer, fields) {
  const res = await fetch(`${DOCS}/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: fields ? JSON.stringify({ fields }) : undefined,
  })
  return res.status
}
// Creates only (fails if the doc exists), so the create rule is what's tested
const create = (path, bearer, fields) => {
  const [parent, id] = [path.split('/').slice(0, -1).join('/'), path.split('/').at(-1)]
  return fetch(`${DOCS}/${parent}?documentId=${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  }).then(r => r.status)
}

const school = fields => db.collection('schools').doc('molkom').set({ name: 'Test', ...fields })
const LIMITED = { planSelection: { rentalInventory: 'starter', academy: 'starter' }, maxAssets: 50, maxStudents: 30 }

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.collection('users').doc('emu-admin').set({ role: 'admin', displayName: 'Admin' })
})

// ── pricing.ts ───────────────────────────────────────────────────────────────

test('limit states: warning from 90%, over from 100%, blocked from 110%', () => {
  const s = n => pricing.limitState(n, 30)
  assert.deepEqual([26, 27, 29, 30, 32, 33, 40].map(s), ['ok', 'warn', 'warn', 'over', 'over', 'blocked', 'blocked'])
  assert.deepEqual([44, 45, 54, 55].map(n => pricing.limitState(n, 50)), ['ok', 'warn', 'over', 'blocked'])
  assert.equal(pricing.limitState(5000, null), 'ok', 'no limit')
  assert.equal(pricing.canAddOne(76, 70), true)
  assert.equal(pricing.canAddOne(77, 70), false, '70 × 110% = 77')
})

test('final numbers: students 30/70/unlimited, assets 50/200/unlimited', () => {
  assert.deepEqual(pricing.PLANS.academy.map(p => p.maxStudents), [30, 70, undefined])
  assert.deepEqual(pricing.PLANS.rentalInventory.map(p => p.maxAssets), [50, 200, undefined])
})

test('upgrade: the next plan with a higher limit', () => {
  assert.equal(pricing.upgradeFor('students', 'starter').name, 'Standard')
  assert.equal(pricing.upgradeFor('students', 'standard').name, 'Plus')
  assert.equal(pricing.upgradeFor('assets', 'standard').name, 'Plus')
  assert.equal(pricing.upgradeFor('assets', 'plus'), null)
})

test('plan features: kits/maintenance Standard+, rental export Plus, academy export Standard+; no plan keeps all', () => {
  const has = (sel, f) => pricing.planHasFeature(sel, f)
  assert.equal(has({ rentalInventory: 'starter' }, 'kits'), false)
  assert.equal(has({ rentalInventory: 'standard' }, 'kits'), true)
  assert.equal(has({ rentalInventory: 'standard' }, 'maintenance'), true)
  assert.equal(has({ rentalInventory: 'standard' }, 'rentalExport'), false)
  assert.equal(has({ rentalInventory: 'plus' }, 'rentalExport'), true)
  assert.equal(has({ academy: 'starter' }, 'academyExport'), false)
  assert.equal(has({ academy: 'standard' }, 'academyExport'), true)
  assert.equal(has({ academy: 'plus' }, 'kits'), false, 'module not in the plan')
  for (const f of Object.keys(pricing.PLAN_FEATURES)) assert.equal(has(undefined, f), true, `legacy school: ${f}`)
})

// ── usage.ts ─────────────────────────────────────────────────────────────────

test('counting: active assets; active students in open classes, once each', async () => {
  await school(LIMITED)
  const b = db.batch()
  b.set(db.doc('equipment/a'), { name: 'a', isActive: true, totalQuantity: 10 })
  b.set(db.doc('equipment/b'), { name: 'b' })
  b.set(db.doc('equipment/c'), { name: 'c', isActive: false })
  b.set(db.doc('cohorts/old'), { name: 'Old', archived: true })
  b.set(db.doc('cohorts/new'), { name: 'New' })
  b.set(db.doc('users/s1'), { role: 'student', cohortId: 'new' })
  b.set(db.doc('users/s2'), { role: 'student' })
  b.set(db.doc('users/s3'), { role: 'student', cohortId: 'old' })
  b.set(db.doc('users/s4'), { role: 'student', isActive: false })
  b.set(db.doc('users/s5'), { role: 'student', disabled: true })
  b.set(db.doc('users/t1'), { role: 'teacher' })
  b.set(db.doc('users/s6'), { role: 'teacher', roles: ['teacher', 'student'] })
  await b.commit()
  assert.equal(await usage.countAssets(), 2, 'a (10 units = 1 asset) and b; inactive c not')
  assert.equal(await usage.countStudents(), 3, 's1, s2 and s6')
  const u = await usage.refreshUsage()
  assert.deepEqual({ assets: u.assets, students: u.students }, { assets: 2, students: 3 })
  assert.equal((await db.doc('schools/molkom').get()).data().usage.students, 3)
})

test('no plan: nothing counted, nothing blocked', async () => {
  await school({ maxStudents: 1 })
  await db.doc('users/s1').set({ role: 'student' })
  await db.doc('users/s2').set({ role: 'student' })
  assert.equal(await usage.refreshUsage(), null)
  await usage.assertCanAdd('students')
})

test('assertCanAdd: blocked from 110%, with the numbers and how to upgrade', async () => {
  await school({ ...LIMITED, maxStudents: 2 })
  await db.doc('users/s1').set({ role: 'student' })
  await usage.assertCanAdd('students') // 1 of 2
  await db.doc('users/s2').set({ role: 'student' })
  await usage.assertCanAdd('students') // 2 of 2: over, not blocked (2 × 100 < 2 × 110)
  await db.doc('users/s3').set({ role: 'student' })
  await assert.rejects(usage.assertCanAdd('students'), e => e.code === 'resource-exhausted'
    && /3 of 2 students/.test(e.message) && /Upgrade to Academy Standard \(up to 70 students\)/.test(e.message)
    && /Nothing is removed/.test(e.message))
  await school({ ...LIMITED, maxStudents: null })
  await usage.assertCanAdd('students') // superadmin override: no limit
})

// ── firestore.rules ──────────────────────────────────────────────────────────

test('rules: new equipment blocked at 110% of the asset limit, editing still allowed', async () => {
  await school({ ...LIMITED, usage: { assets: 54 } })
  assert.equal(await create('equipment/n1', ADMIN, { name: str('n1') }), 200, '54 of 50: may add the 55th')
  await school({ ...LIMITED, usage: { assets: 55 } })
  assert.equal(await create('equipment/n2', ADMIN, { name: str('n2') }), 403, '55 of 50 (110%): blocked')
  assert.equal(await call('PATCH', 'equipment/n1?updateMask.fieldPaths=name', ADMIN, { name: str('renamed') }), 200, 'existing items stay editable')
  assert.equal(await call('DELETE', 'equipment/n1', ADMIN), 200, 'and removable')
  await school({ ...LIMITED, maxAssets: null, usage: { assets: 55 } })
  assert.equal(await create('equipment/n3', ADMIN, { name: str('n3') }), 200, 'override: no limit')
  await school({ usage: { assets: 999 }, maxAssets: 50 })
  assert.equal(await create('equipment/n4', ADMIN, { name: str('n4') }), 200, 'no plan: never blocked')
})

test('rules: student invitations and sign-ups blocked at 110% of the student limit', async () => {
  await school({ ...LIMITED, usage: { students: 33 } })
  assert.equal(await create('invitations/i1', ADMIN, { email: str('a@example.test'), role: str('student'), used: bool(false) }), 403)
  assert.equal(await create('invitations/i2', ADMIN, { email: str('t@example.test'), role: str('teacher'), used: bool(false) }), 200, 'teachers are not limited')
  await db.doc('invitations/i3').set({ email: 'new@example.test', role: 'student', cohortId: null, used: false })
  const signup = { role: str('student'), displayName: str('New'), inviteId: str('i3'), cohortId: { nullValue: null } }
  assert.equal(await create('users/new1', token('new1', null, 'new@example.test'), signup), 403, 'sign-up blocked at the limit')
  await school({ ...LIMITED, usage: { students: 32 } })
  assert.equal(await create('invitations/i4', ADMIN, { email: str('b@example.test'), role: str('student'), used: bool(false) }), 200, '32 of 30: allowed')
  assert.equal(await create('users/new1', token('new1', null, 'new@example.test'), signup), 200, 'sign-up allowed below 110%')
})

test('rules: kits and maintenance need Rental Standard; read stays after a downgrade', async () => {
  await db.doc('kits/k1').set({ name: 'Kit' })
  await db.doc('equipment/e1').set({ name: 'Cam' })
  await school({ planSelection: { rentalInventory: 'starter' } })
  assert.equal(await create('kits/k2', ADMIN, { name: str('x') }), 403)
  assert.equal(await create('equipment/e1/maintenance/m1', ADMIN, { note: str('x') }), 403)
  assert.equal(await call('GET', 'kits/k1', ADMIN), 200, 'existing kits still readable')
  await school({ planSelection: { rentalInventory: 'standard' } })
  assert.equal(await create('kits/k2', ADMIN, { name: str('x') }), 200)
  assert.equal(await create('equipment/e1/maintenance/m1', ADMIN, { note: str('x') }), 200)
  await school({})
  assert.equal(await create('kits/k3', ADMIN, { name: str('x') }), 200, 'no plan: as before')
})

test("rules: a school admin can't change the plan, limits, usage or modules", async () => {
  await school({ ...LIMITED, currency: 'SEK' })
  for (const [field, value] of [['maxStudents', { integerValue: '999' }], ['maxAssets', { nullValue: null }],
    ['planSelection', { mapValue: { fields: { academy: str('plus') } } }], ['usage', { mapValue: { fields: {} } }],
    ['modules', { mapValue: { fields: { academy: bool(true) } } }]]) {
    assert.equal(await call('PATCH', `schools/molkom?updateMask.fieldPaths=${field}`, ADMIN, { [field]: value }), 403, field)
  }
  assert.equal(await call('PATCH', 'schools/molkom?updateMask.fieldPaths=currency', ADMIN, { currency: str('EUR') }), 200, 'other fields as before')
})

// ── updateSchoolModules: plan and asset limit ────────────────────────────────

test('superadmin input: a plan for every module that is on; omitted fields unchanged; audited', async () => {
  process.env.SUPERADMIN_EMAILS ||= 'boss@example.test'
  const { validateModulesInput, applySchoolUpdate } = await import('../lib/school-admin.js')
  const base = { modules: { academy: true, production: false, rentalInventory: true }, publicShop: false, planName: null, maxStudents: 30, storageQuotaGB: null }
  assert.throws(() => validateModulesInput({ ...base, planSelection: { academy: 'starter' } }), /every module that is on/)
  assert.throws(() => validateModulesInput({ ...base, planSelection: { academy: 'gold', rentalInventory: 'starter' } }), /Unknown plan/)
  const v = validateModulesInput({ ...base, maxAssets: 60, planSelection: { academy: 'starter', rentalInventory: 'standard', production: 'plus' } })
  assert.deepEqual(v.planSelection, { academy: 'starter', rentalInventory: 'standard' }, 'plans of modules that are off are dropped')
  assert.equal(v.maxAssets, 60)
  assert.equal('planSelection' in validateModulesInput(base), false, 'omitted: unchanged')

  await school({ maxAssets: 50, planSelection: { academy: 'plus' } })
  await applySchoolUpdate(validateModulesInput(base), { uid: 'u1', email: 'boss@example.test' })
  let s = (await db.doc('schools/molkom').get()).data()
  assert.deepEqual([s.maxAssets, s.planSelection], [50, { academy: 'plus' }], 'left alone when not sent')
  await applySchoolUpdate(v, { uid: 'u1', email: 'boss@example.test' })
  s = (await db.doc('schools/molkom').get()).data()
  assert.deepEqual([s.maxAssets, s.planSelection.rentalInventory], [60, 'standard'])
  await applySchoolUpdate(validateModulesInput({ ...base, maxAssets: null, planSelection: null }), { uid: 'u1', email: 'boss@example.test' })
  s = (await db.doc('schools/molkom').get()).data()
  assert.deepEqual([s.maxAssets, s.planSelection], [undefined, undefined], 'null removes: no limits')
  const audit = (await db.collection('school_audit').get()).docs.map(d => d.data())
  assert.ok(audit.some(a => a.after.school.planSelection?.rentalInventory === 'standard' && a.before.school.planSelection?.academy === 'plus'))
})
