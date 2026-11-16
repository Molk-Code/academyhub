// The public rental shop: open/closed (school admin, superadmin override),
// the server-checked password and the locked catalog, against the Firestore
// emulator:
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db, SCHOOL_ID } = await import('../lib/lib.js')
const shop = await import('../lib/shop.js')

const school = () => db.collection('schools').doc(SCHOOL_ID)
const rental = { academy: false, production: false, rentalInventory: true }

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
})

test('open: the superadmin override wins, else the school admin; only with Rental & Inventory; legacy unchanged', () => {
  assert.equal(shop.shopOpen({ modules: rental }), false, 'default closed')
  assert.equal(shop.shopOpen({ modules: rental, publicShop: true }), true, 'admin opened it')
  assert.equal(shop.shopOpen({ modules: rental, publicShop: true, publicShopOverride: 'off' }), false, 'superadmin: always closed')
  assert.equal(shop.shopOpen({ modules: rental, publicShop: false, publicShopOverride: 'on' }), true, 'superadmin: always open')
  assert.equal(shop.shopOpen({ modules: { ...rental, rentalInventory: false }, publicShopOverride: 'on' }), false, 'no Rental & Inventory')
  assert.equal(shop.shopOpen({ productType: 'rental' }), true, 'legacy rental mode')
  assert.equal(shop.shopOpen({ productType: 'education' }), false, 'legacy school')
})

test('settings: validated; the password is stored hashed, privately, and checked on the server', async () => {
  assert.throws(() => shop.validateShopSettings({}), e => e.code === 'invalid-argument', 'nothing to change')
  assert.throws(() => shop.validateShopSettings({ open: 'yes' }), e => e.code === 'invalid-argument')
  assert.throws(() => shop.validateShopSettings({ password: '123' }), e => e.code === 'invalid-argument', 'too short')

  await school().set({ modules: rental })
  let r = await shop.applyShopSettings(shop.validateShopSettings({ open: true, password: 'film-gear-1' }), { uid: 'a' })
  assert.deepEqual(r, { open: true, adminOpen: true, override: null, locked: true })
  const s = (await school().get()).data()
  assert.equal(s.shopLocked, true)
  assert.equal(JSON.stringify(s).includes('film-gear-1'), false, 'no password in the public school record')
  const priv = (await db.collection('shop_private').doc('config').get()).data()
  assert.ok(priv.hash && priv.salt && !JSON.stringify(priv).includes('film-gear-1'), 'hashed')

  assert.equal(await shop.shopPasswordMatches('film-gear-1'), true)
  assert.equal(await shop.shopPasswordMatches('film-gear-2'), false)
  assert.equal(await shop.shopPasswordMatches(undefined), false)

  await shop.requireShopAccess(s, 'film-gear-1', '203.0.113.1')
  await assert.rejects(shop.requireShopAccess(s, 'nope', '203.0.113.1'), e => e.code === 'permission-denied')
  await assert.rejects(shop.requireShopAccess({ ...s, publicShopOverride: 'off' }, 'film-gear-1', '203.0.113.1'), e => e.code === 'unauthenticated', 'closed')

  r = await shop.applyShopSettings({ password: null }, { uid: 'a' })
  assert.equal(r.locked, false)
  assert.equal((await db.collection('shop_private').doc('config').get()).exists, false, 'hash removed')
  await shop.requireShopAccess((await school().get()).data(), undefined, '203.0.113.1')
})

test('settings: the override is reported and needs Rental & Inventory', async () => {
  await school().set({ modules: rental, publicShopOverride: 'off' })
  const r = await shop.applyShopSettings({ open: true }, { uid: 'a' })
  assert.deepEqual(r, { open: false, adminOpen: true, override: 'off', locked: false }, 'the admin choice is kept for when the override goes')
  await school().set({ modules: { ...rental, rentalInventory: false } })
  await assert.rejects(shop.applyShopSettings({ open: true }, { uid: 'a' }), e => e.code === 'failed-precondition')
})

test('password attempts are rate-limited per IP', async () => {
  await school().set({ modules: rental, publicShop: true })
  await shop.applyShopSettings({ password: 'film-gear-1' }, { uid: 'a' })
  const s = (await school().get()).data()
  for (let i = 0; i < 10; i++) await assert.rejects(shop.requireShopAccess(s, 'wrong', '198.51.100.7'), e => e.code === 'permission-denied')
  await assert.rejects(shop.requireShopAccess(s, 'film-gear-1', '198.51.100.7'), e => e.code === 'resource-exhausted', 'blocked for a while')
  await shop.requireShopAccess(s, 'film-gear-1', '198.51.100.8')
})

test('locked catalog: active items only, without internal fields', async () => {
  await db.collection('equipment').doc('cam').set({ name: 'FX6', category: 'CAMERA', isActive: true, priceInclVat: 900, notes: 'internal', location: 'Shelf 3', serviceUnits: [] })
  await db.collection('equipment').doc('old').set({ name: 'Old', category: 'CAMERA', isActive: false })
  await db.collection('equipment_categories').doc('c').set({ label: 'Camera', order: 1 })
  const c = await shop.lockedShopCatalog()
  assert.deepEqual(c.equipment, [{ id: 'cam', name: 'FX6', category: 'CAMERA', isActive: true, priceInclVat: 900 }])
  assert.equal(c.categories.length, 1)
})
