// updateSchoolModules / uploadSchoolLogo, against the Firestore emulator:
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')
process.env.SUPERADMIN_EMAILS = 'boss@example.test, Second@Example.test'

const { db } = await import('../lib/lib.js')
const { validateModulesInput, applySchoolUpdate, requireSuperAdmin, validateLogo, checkSchoolDeletion } = await import('../lib/school-admin.js')

const valid = {
  modules: { academy: true, production: false, rentalInventory: true },
  publicShop: true, planName: 'Academy + Rental', maxStudents: 250, storageQuotaGB: 50,
  profile: { name: 'Nordic Film Academy', primaryColor: '#0ea5e9', frontDoor: 'academy', tagline: 'Film education' },
}
const ctx = (email, verified = true) => ({ auth: { uid: 'u1', token: { email, email_verified: verified } } })

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.collection('schools').doc('molkom').set({ name: 'Molkom', tier: 'studio', productType: 'education', maxStudents: 100 })
})

test('only verified superadmin emails pass, case-insensitively', () => {
  assert.deepEqual(requireSuperAdmin(ctx('boss@example.test')), { uid: 'u1', email: 'boss@example.test' })
  assert.equal(requireSuperAdmin(ctx('SECOND@example.test')).email, 'second@example.test')
  assert.throws(() => requireSuperAdmin(ctx('boss@example.test', false)), e => e.code === 'failed-precondition' && /Verify your email/.test(e.message), 'unverified: told to verify')
  assert.throws(() => requireSuperAdmin(ctx('admin@example.test')), e => e.code === 'permission-denied', 'school admin')
  assert.throws(() => requireSuperAdmin({}), e => e.code === 'unauthenticated')
})

test('an empty SUPERADMIN_EMAILS lets nobody in', () => {
  const saved = process.env.SUPERADMIN_EMAILS
  process.env.SUPERADMIN_EMAILS = ''
  try { assert.throws(() => requireSuperAdmin(ctx('boss@example.test')), e => e.code === 'permission-denied') }
  finally { process.env.SUPERADMIN_EMAILS = saved }
})

test('input is validated strictly', () => {
  const bad = patch => assert.throws(() => validateModulesInput({ ...valid, ...patch }), e => e.code === 'invalid-argument', JSON.stringify(patch))
  bad({ modules: { academy: true, production: false } })
  bad({ modules: { academy: 'yes', production: false, rentalInventory: true } })
  bad({ modules: { academy: true, production: false, rentalInventory: true, billing: true } })
  bad({ modules: { academy: true, production: false, rentalInventory: false }, publicShop: true })
  bad({ planName: 'p'.repeat(61) })
  bad({ maxStudents: -1 })
  bad({ maxStudents: 2.5 })
  bad({ storageQuotaGB: 'lots' })
  bad({ profile: { primaryColor: 'orange' } })
  bad({ profile: { frontDoor: 'billing' } })
  bad({ profile: { logoUrl: 'javascript:alert(1)' } })
  bad({ profile: { favicon: 'x' } })
  bad({ schoolId: 'Not An Id!' })
  bad({ schoolId: 'other-school' }) // the login profile belongs to this deployment's school only
  assert.doesNotThrow(() => validateModulesInput({ ...valid, schoolId: 'other-school', profile: undefined }))
  assert.equal(validateModulesInput({ ...valid, planName: '', maxStudents: null }).planName, null)
})

test('a save writes the school, the login profile and an audit entry with before and after', async () => {
  const after = await applySchoolUpdate(validateModulesInput(valid), { uid: 'u1', email: 'boss@example.test' })

  const school = (await db.collection('schools').doc('molkom').get()).data()
  assert.deepEqual(school.modules, valid.modules)
  assert.equal(school.publicShop, true)
  assert.equal(school.planName, 'Academy + Rental')
  assert.equal(school.maxStudents, 250)
  assert.equal(school.storageQuotaGB, 50)
  assert.equal(school.tier, 'studio', 'legacy fields are kept as they were')
  assert.equal(school.productType, 'education')

  const profile = (await db.collection('public_config').doc('main').get()).data()
  assert.deepEqual(profile, valid.profile)

  const audit = (await db.collection('school_audit').get()).docs.map(d => d.data())
  assert.equal(audit.length, 1)
  assert.equal(audit[0].schoolId, 'molkom')
  assert.deepEqual(audit[0].by, { uid: 'u1', email: 'boss@example.test' })
  assert.ok(audit[0].at)
  assert.equal(audit[0].before.school.modules, null, 'legacy school had no modules')
  assert.equal(audit[0].before.school.maxStudents, 100)
  assert.deepEqual(audit[0].after.school.modules, valid.modules)
  assert.equal(audit[0].after.profile.name, 'Nordic Film Academy')
  assert.deepEqual(after.school.modules, valid.modules)
})

test('clearing optional values deletes them; omitting the profile leaves it alone', async () => {
  await applySchoolUpdate(validateModulesInput(valid), { uid: 'u1', email: 'boss@example.test' })
  await applySchoolUpdate(validateModulesInput({ ...valid, planName: '', storageQuotaGB: null, profile: { tagline: '' } }), { uid: 'u1', email: 'boss@example.test' })
  const school = (await db.collection('schools').doc('molkom').get()).data()
  assert.equal('planName' in school, false)
  assert.equal('storageQuotaGB' in school, false)
  const profile = (await db.collection('public_config').doc('main').get()).data()
  assert.equal('tagline' in profile, false)
  assert.equal(profile.name, 'Nordic Film Academy', 'untouched profile fields stay')
  assert.equal((await db.collection('school_audit').get()).size, 2)
})

test('an unknown school is refused and nothing is written', async () => {
  await assert.rejects(applySchoolUpdate(validateModulesInput({ ...valid, schoolId: 'nope', profile: undefined }), { uid: 'u1', email: 'boss@example.test' }), e => e.code === 'not-found')
  assert.equal((await db.collection('school_audit').get()).size, 0)
})

test('logo uploads accept small images only', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
  assert.equal(validateLogo({ contentType: 'image/png', base64: png }).bytes.length, 4)
  assert.throws(() => validateLogo({ contentType: 'text/html', base64: png }), e => e.code === 'invalid-argument')
  assert.throws(() => validateLogo({ contentType: 'image/png', base64: '' }), e => e.code === 'invalid-argument')
  const big = Buffer.alloc(1024 * 1024 + 1).toString('base64')
  assert.throws(() => validateLogo({ contentType: 'image/png', base64: big }), e => e.code === 'invalid-argument')
})

test("deleting a school: never the deployment's own, and only with its exact name", () => {
  const school = { name: 'Nordic Film Academy' }
  assert.equal(checkSchoolDeletion('nordic', 'Nordic Film Academy', school, 'molkom'), null)
  assert.equal(checkSchoolDeletion('nordic', '  Nordic Film Academy ', school, 'molkom'), null)
  assert.match(checkSchoolDeletion('molkom', 'Molkom', { name: 'Molkom' }, 'molkom'), /own school/)
  assert.match(checkSchoolDeletion('nordic', 'nordic film academy', school, 'molkom'), /doesn't match/)
  assert.match(checkSchoolDeletion('nordic', undefined, school, 'molkom'), /doesn't match/)
  assert.match(checkSchoolDeletion('gone', 'x', undefined, 'molkom'), /not found/)
  assert.match(checkSchoolDeletion('', 'x', school, 'molkom'), /required/)
})

test('superadmin session: a Google sign-in from the last 12 hours, with the superadmin address itself', async () => {
  const { superAdminSessionProblem } = await import('../lib/school-admin.js')
  const now = 1_800_000_000_000
  const google = (hoursAgo, provider = 'google.com') => ({ auth_time: now / 1000 - hoursAgo * 3600, firebase: { sign_in_provider: provider } })
  assert.equal(superAdminSessionProblem(google(1), 'boss@example.test', 'Boss@Example.test', now), null)
  assert.match(superAdminSessionProblem(google(1, 'password'), 'boss@example.test', 'boss@example.test', now), /Confirm with Google/)
  assert.match(superAdminSessionProblem(google(13), 'boss@example.test', 'boss@example.test', now), /last 12 hours/)
  assert.match(superAdminSessionProblem(google(1), 'boss@example.test', 'someone@example.test', now), /superadmin address itself/)
  assert.match(superAdminSessionProblem(google(1), 'boss@example.test', undefined, now), /superadmin address itself/)
  assert.match(superAdminSessionProblem({}, 'boss@example.test', 'boss@example.test', now), /Confirm with Google/)
})
