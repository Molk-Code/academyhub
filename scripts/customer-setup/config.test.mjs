// node --test scripts/customer-setup/config.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectIdFor, relativeName, recordsToAdd, recordsForAddress, webEnv, functionsEnv, firebaseConfig, planFields, shopDomainProblem, customerDnsRecords } from './config.mjs'

test('project ids: cf-<short name>-<4>, at most 30 characters, valid', () => {
  const id = projectIdFor('test-setup', () => 0.5)
  assert.match(id, /^cf-test-setup-[a-z0-9]{4}$/)
  const long = projectIdFor('a-very-long-school-short-name-x', () => 0.1)
  assert.ok(long.length <= 30, long)
  assert.match(long, /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/)
  assert.doesNotMatch(long, /--/)
})

test('relative names inside the zone', () => {
  assert.equal(relativeName('test-setup.cineforge.se', 'cineforge.se'), 'test-setup')
  assert.equal(relativeName('_acme-challenge.test-setup.cineforge.se.', 'cineforge.se'), '_acme-challenge.test-setup')
  assert.equal(relativeName('cineforge.se', 'cineforge.se'), '@')
  assert.throws(() => relativeName('evil.example.com', 'cineforge.se'))
})

test('records to add: only for the address, only ADD, never the zone root', () => {
  const cd = {
    requiredDnsUpdates: { desired: [
      { domainName: 'test-setup.cineforge.se', records: [
        { type: 'A', rdata: '199.36.158.100', requiredAction: 'ADD' },
        { type: 'TXT', rdata: '"hosting-site=cf-test-setup-ab12"', requiredAction: 'ADD' },
        { type: 'A', rdata: '1.2.3.4', requiredAction: 'REMOVE' },
      ] },
      { domainName: 'cineforge.se', records: [{ type: 'A', rdata: '9.9.9.9', requiredAction: 'ADD' }] },
    ] },
    cert: { verification: { dns: { desired: [
      { domainName: '_acme-challenge.test-setup.cineforge.se.', records: [{ type: 'CNAME', rdata: 'x.authorize.certificatemanager.goog.', requiredAction: 'ADD' }] },
    ] } } },
  }
  assert.deepEqual(recordsToAdd(cd, 'test-setup.cineforge.se', 'cineforge.se'), [
    { type: 'A', name: 'test-setup', value: '199.36.158.100', ttl: 300 },
    { type: 'TXT', name: 'test-setup', value: 'hosting-site=cf-test-setup-ab12', ttl: 300 },
    { type: 'CNAME', name: '_acme-challenge.test-setup', value: 'x.authorize.certificatemanager.goog.', ttl: 300 },
  ])
  assert.deepEqual(recordsToAdd({}, 'x.cineforge.se', 'cineforge.se'), [])
})

test('records for removal: the address and names under it only', () => {
  const recs = [
    { id: 1, name: 'test-setup.cineforge.se' }, { id: 2, name: '_acme-challenge.test-setup.cineforge.se' },
    { id: 3, name: 'cineforge.se' }, { id: 4, name: 'www.cineforge.se' }, { id: 5, name: 'other-test-setup.cineforge.se' },
  ]
  assert.deepEqual(recordsForAddress(recs, 'test-setup.cineforge.se').map(r => r.id), [1, 2])
})

test('generated files', () => {
  const web = webEnv({ webConfig: { apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p', storageBucket: 'p.firebasestorage.app', messagingSenderId: '1', appId: 'a' }, schoolId: 'test-setup', address: 'test-setup.cineforge.se' })
  assert.match(web, /^VITE_FIREBASE_PROJECT_ID=p$/m)
  assert.match(web, /^VITE_SCHOOL_ID=test-setup$/m)
  assert.match(web, /^VITE_FUNCTIONS_REGION=europe-west1$/m)
  assert.match(web, /^VITE_FIREBASE_VAPID_KEY=$/m)
  const fn = functionsEnv({ projectId: 'p', schoolId: 's', address: 's.cineforge.se', superadminEmails: 'a@example.test' })
  assert.match(fn, /^APP_URL=https:\/\/s\.cineforge\.se$/m)
  assert.match(fn, /^BACKUP_BUCKET=p-backups$/m)
  assert.match(fn, /^SUPERADMIN_REQUIRE_GOOGLE=true$/m)
  const cfg = firebaseConfig({ hosting: { public: 'dist', predeploy: [] }, firestore: { rules: 'firestore.rules', indexes: 'i.json' }, emulators: {} }, { mode: 'customer', schoolId: 's' })
  assert.equal(cfg.hosting.public, 'dist-customer')
  assert.equal(cfg.firestore.rules, 'firestore.s.rules')
  assert.equal(cfg.firestore.indexes, 'i.json')
  assert.ok(!('emulators' in cfg))
})

test('plan fields for schools/<id>: from the order plan, missing limits are null', () => {
  const f = planFields({ modules: { academy: false, production: false, rentalInventory: true }, planName: 'Rental Plus', selection: { rentalInventory: 'plus' }, maxAssets: 1500 })
  assert.deepEqual(f, {
    modules: { academy: false, production: false, rentalInventory: true }, planName: 'Rental Plus',
    planSelection: { rentalInventory: 'plus' }, maxStudents: null, maxAssets: 1500, storageQuotaGB: null,
  })
})

test('shop address: a real hostname, not under our own zone', () => {
  assert.equal(shopDomainProblem('rent.example.com', 'cineforge.se'), null)
  assert.match(shopDomainProblem('', 'cineforge.se'), /Enter an address/)
  assert.match(shopDomainProblem('https://rent.example.com', 'cineforge.se'), /not a valid/)
  assert.match(shopDomainProblem('localhost', 'cineforge.se'), /not a valid/)
  assert.match(shopDomainProblem('shop.cineforge.se', 'cineforge.se'), /set up by CineForge/)
})

test('shop address: the records to give the customer, full names, ADD only', () => {
  const cd = {
    requiredDnsUpdates: { desired: [
      { domainName: 'rent.example.com', records: [{ type: 'A', rdata: '199.36.158.100', requiredAction: 'ADD' }, { type: 'A', rdata: '1.2.3.4', requiredAction: 'REMOVE' }] },
      { domainName: 'other.example.com', records: [{ type: 'A', rdata: '9.9.9.9', requiredAction: 'ADD' }] },
    ] },
    cert: { verification: { dns: { desired: [{ domainName: '_acme-challenge.rent.example.com.', records: [{ type: 'TXT', rdata: '"tok"', requiredAction: 'ADD' }] }] } } },
  }
  assert.deepEqual(customerDnsRecords(cd, 'rent.example.com'), [
    { type: 'A', name: 'rent.example.com', value: '199.36.158.100' },
    { type: 'TXT', name: '_acme-challenge.rent.example.com', value: 'tok' },
  ])
})
