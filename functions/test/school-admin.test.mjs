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
const { validateModulesInput, applySchoolUpdate, requireSuperAdmin, validateLogo } = await import('../lib/school-admin.js')

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
  assert.throws(() => requireSuperAdmin(ctx('boss@example.test', false)), e => e.code === 'permission-denied', 'unverified')
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
