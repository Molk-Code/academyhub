// Customer orders (onboarding.ts), against the Firestore emulator:
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db } = await import('../lib/lib.js')
const ob = await import('../lib/onboarding.js')

const valid = {
  organisation: { name: 'Nordic Film Municipality', orgNumber: '' },
  school: { name: 'Nordic Film Academy', shortName: 'Nordic' },
  admin: { name: 'Alex Admin', email: 'Alex@Example.test' },
  billing: { email: 'invoices@example.test', reference: 'REF 12' },
  plan: { selection: { academy: 'medium', rentalInventory: 'standard' }, maxStudents: 200 },
  payment: { method: 'invoice' },
  startPolicy: 'after_payment',
  notes: 'met at a fair',
}
const boss = { email: 'boss@example.test' }
const steps = ok => Object.fromEntries(ob.PROVISIONING_STEPS.map(s => [s.id, async () => { if (s.id === ok) throw new Error('DNS said no'); return { did: s.id } }]))
const order = async id => (await db.collection('customer_orders').doc(id).get()).data()

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
})

test('order input is validated; self-service is stricter', () => {
  const v = ob.validateOrderInput(valid, { selfService: false })
  assert.equal(v.school.shortName, 'nordic')
  assert.equal(v.admin.email, 'alex@example.test')
  assert.equal(v.organisation.orgNumber, null)
  assert.equal(v.notes, 'met at a fair')
  assert.equal(ob.validateOrderInput(valid, { selfService: true }).notes, null)

  const bad = (patch, selfService = false) => assert.throws(() => ob.validateOrderInput({ ...valid, ...patch }, { selfService }), e => e.code === 'invalid-argument', JSON.stringify(patch))
  bad({ school: { name: 'X', shortName: 'www' } })
  bad({ school: { name: 'X', shortName: 'a' } })
  bad({ school: { name: 'X', shortName: '1abc' } })
  bad({ school: { name: 'X', shortName: 'ab--cd' } })
  bad({ admin: { name: 'A', email: 'not-an-email' } })
  bad({ plan: { selection: {} } })
  bad({ plan: { selection: { academy: 'huge' } } })
  bad({ plan: { selection: { billing: 'starter' } } })
  bad({ payment: { method: 'card' } })
  bad({ payment: { method: 'bitcoin' } })
  bad({ startPolicy: 'immediately' }, true)
  bad({ organisation: { name: '' } })
})

test('invoice paid later: waits, then setup runs to live', async () => {
  const id = await ob.createOrder(ob.validateOrderInput(valid, { selfService: false }), { source: 'superadmin', by: boss })
  let o = await order(id)
  assert.equal(o.status, 'awaiting_payment')
  assert.equal(o.address, 'nordic.cineforge.se')
  assert.equal(o.payment.status, 'pending')

  await assert.rejects(ob.createOrder(ob.validateOrderInput(valid, { selfService: false }), { source: 'superadmin', by: boss }), e => e.code === 'already-exists', 'short name reserved')

  await ob.confirmPayment(id, boss, { invoiceNumber: 'F-1001' })
  o = await order(id)
  assert.equal(o.status, 'queued')
  assert.equal(o.payment.status, 'paid')
  assert.equal(o.payment.invoiceNumber, 'F-1001')
  await assert.rejects(ob.confirmPayment(id, boss), e => e.code === 'failed-precondition', 'paid twice')

  assert.equal(await ob.runProvisioning(id, steps(null)), 'live')
  o = await order(id)
  assert.equal(o.status, 'live')
  assert.ok(ob.PROVISIONING_STEPS.every(s => o.provisioning.steps[s.id].status === 'done'))
  assert.equal(o.provisioning.steps.domain.did, 'domain')
  await assert.rejects(ob.cancelOrder(id, boss), e => /remove it instead/.test(e.message), 'live orders are not cancelled')

  const events = (await db.collection('customer_orders').doc(id).collection('events').get()).docs.map(d => d.data().action).sort()
  assert.deepEqual(events, ['created', 'live', 'payment_confirmed'])
})

test('start now, pay later: payment afterwards only records it', async () => {
  const id = await ob.createOrder(ob.validateOrderInput({ ...valid, startPolicy: 'immediately' }, { selfService: false }), { source: 'superadmin', by: boss })
  assert.equal((await order(id)).status, 'queued')
  await ob.runProvisioning(id, steps(null))
  await ob.confirmPayment(id, { provider: 'card-provider' }, { providerRef: 'pi_1' })
  const o = await order(id)
  assert.equal(o.status, 'live')
  assert.equal(o.payment.status, 'paid')
  assert.deepEqual(o.payment.confirmedBy, { provider: 'card-provider' })
})

test('a failed step stops setup; retry continues where it stopped', async () => {
  const id = await ob.createOrder(ob.validateOrderInput(valid, { selfService: false }), { source: 'superadmin', by: boss })
  await ob.startOrderNow(id, boss)
  assert.equal(await ob.runProvisioning(id, steps('domain')), 'failed')
  let o = await order(id)
  assert.equal(o.provisioning.steps.school.status, 'done')
  assert.equal(o.provisioning.steps.domain.status, 'failed')
  assert.equal(o.provisioning.steps.invite.status, 'pending')
  assert.match(o.provisioning.error, /Address and DNS: DNS said no/)

  await ob.retryOrder(id, boss)
  const ran = []
  const tracking = Object.fromEntries(ob.PROVISIONING_STEPS.map(s => [s.id, async () => { ran.push(s.id) }]))
  assert.equal(await ob.runProvisioning(id, tracking), 'live')
  assert.deepEqual(ran, ['domain', 'signin_domain', 'invite'])
  o = await order(id)
  assert.equal(o.provisioning.attempts, 2)
})

test('setup switched off: the order waits in the queue with a note', async () => {
  const id = await ob.createOrder(ob.validateOrderInput({ ...valid, startPolicy: 'immediately' }, { selfService: false }), { source: 'superadmin', by: boss })
  assert.equal(ob.provisionerFor(undefined), null)
  assert.equal(await ob.runProvisioning(id, null), 'queued')
  assert.match((await order(id)).provisioning.note, /not switched on/)
})

test('cancelling frees the short name', async () => {
  const id = await ob.createOrder(ob.validateOrderInput(valid, { selfService: false }), { source: 'superadmin', by: boss })
  assert.equal((await ob.shortNameAvailable('nordic')).ok, false)
  await ob.cancelOrder(id, boss)
  assert.equal((await order(id)).status, 'cancelled')
  assert.deepEqual(await ob.shortNameAvailable('nordic'), { ok: true, problem: null, address: 'nordic.cineforge.se' })
  await assert.rejects(ob.confirmPayment(id, boss), e => e.code === 'failed-precondition')
  assert.equal((await ob.shortNameAvailable('admin')).problem, '"admin" is reserved.')
})

test('self-service: closed without terms, needs acceptance, waits for approval', async () => {
  const sent = []
  const deps = v => ({ sendEmail: async m => sent.push(m), notifyEmail: 'orders@example.test', termsVersion: v })
  await assert.rejects(ob.handleSelfServiceOrder({ ...valid, acceptTerms: true }, { ip: '1.2.3.4' }, deps(undefined)), e => e.code === 'unavailable')
  await assert.rejects(ob.handleSelfServiceOrder({ ...valid, acceptTerms: true, termsVersion: 'old' }, { ip: '1.2.3.4' }, deps('2026-11')), e => e.code === 'failed-precondition')
  assert.equal((await ob.handleSelfServiceOrder({ ...valid, website: 'spam' }, { ip: '1.2.3.4' }, deps('2026-11'))).ok, true)
  assert.equal((await db.collection('customer_orders').get()).size, 0, 'honeypot saves nothing')

  await ob.handleSelfServiceOrder({ ...valid, acceptTerms: true, termsVersion: '2026-11' }, { ip: '1.2.3.4' }, deps('2026-11'))
  const [o] = (await db.collection('customer_orders').get()).docs.map(d => d.data())
  assert.equal(o.source, 'self_service')
  assert.equal(o.status, 'awaiting_payment')
  assert.equal(o.notes, null)
  assert.equal(o.terms.version, '2026-11')
  assert.equal(sent.length, 1)
})

test('preview (superadmin, ordering closed): accepts the draft terms version, marks the order, sends no email', async () => {
  const sent = []
  const deps = { sendEmail: async m => sent.push(m), notifyEmail: 'orders@example.test', termsVersion: undefined, preview: true }
  await assert.rejects(ob.handleSelfServiceOrder({ ...valid, acceptTerms: false, termsVersion: 'draft-1' }, { ip: '1.2.3.4' }, deps), e => e.code === 'failed-precondition')
  const r = await ob.handleSelfServiceOrder({ ...valid, acceptTerms: true, termsVersion: 'draft-1' }, { ip: '1.2.3.4' }, deps)
  assert.equal(r.address, 'nordic.cineforge.se')
  const [o] = (await db.collection('customer_orders').get()).docs.map(d => d.data())
  assert.equal(o.preview, true)
  assert.equal(o.terms.version, 'draft-1')
  assert.equal(sent.length, 0)
})

test('setup in Cloud Build: config is checked, the request runs the release as the setup account', () => {
  const saved = { ...process.env }
  try {
    delete process.env.CUSTOMER_FOLDER_ID
    assert.match(ob.setupConfig({ bucket: 'b', object: 'o.tgz' }), /CUSTOMER_FOLDER_ID/)
    Object.assign(process.env, { CUSTOMER_FOLDER_ID: '100', BILLING_ACCOUNT_ID: 'AAA-BBB', SETUP_SERVICE_ACCOUNT: 'setup@ctl.iam.gserviceaccount.com', SUPERADMIN_EMAILS: 'boss@example.test', GCLOUD_PROJECT: 'ctl' })
    assert.match(ob.setupConfig(undefined), /No release published/)
    const cfg = ob.setupConfig({ bucket: 'ctl-releases', object: 'releases/abc.tgz' })
    const req = ob.setupBuildRequest('Order123', 'setup', cfg)
    assert.deepEqual(req.source, { storageSource: { bucket: 'ctl-releases', object: 'releases/abc.tgz' } })
    assert.equal(req.serviceAccount, 'projects/ctl/serviceAccounts/setup@ctl.iam.gserviceaccount.com')
    assert.ok(req.steps[0].env.includes('ORDER_ID=Order123') && req.steps[0].env.includes('MODE=setup') && req.steps[0].env.includes('FOLDER_ID=100'))
    assert.deepEqual(req.steps[0].secretEnv, ['HOSTUP_API_KEY', 'RESEND_API_KEY'])
    assert.ok(req.availableSecrets.secretManager.every(s => s.versionName.startsWith('projects/ctl/secrets/')))
    assert.ok(!req.steps[0].env.some(e => /KEY=/.test(e)), 'no secret values in the build request')
    assert.match(ob.setupBuildRequest('Order123', 'remove', cfg).steps[0].args[1], /^npm ci .*run\.mjs$/)
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
})

test('removal: only set-up customers, with the exact name; a failed removal retries the removal; cancel refuses once a project exists', async () => {
  const id = await ob.createOrder(ob.validateOrderInput({ ...valid, startPolicy: 'immediately' }, { selfService: false }), { source: 'superadmin', by: boss })
  await assert.rejects(ob.requestRemoval(id, boss, 'Nordic Film Academy'), e => e.code === 'failed-precondition', 'queued: nothing to remove')
  await db.collection('customer_orders').doc(id).update({ status: 'failed', 'provisioning.state.projectId': 'cf-nordic-ab12' })
  await assert.rejects(ob.cancelOrder(id, boss), e => /remove the customer instead/.test(e.message))
  await assert.rejects(ob.requestRemoval(id, boss, 'Nordic'), e => /doesn't match/.test(e.message))
  await ob.requestRemoval(id, boss, ' Nordic Film Academy ')
  assert.equal((await order(id)).status, 'removing')
  await db.collection('customer_orders').doc(id).update({ status: 'failed' })
  await ob.retryOrder(id, boss)
  assert.equal((await order(id)).status, 'removing', 'retry of a failed removal')
})

test('prices: plans per module, 20% off all three, billed annually; computed on the server', async () => {
  const pr = await import('../lib/pricing.js')
  const v = ob.validateOrderInput({ ...valid, plan: { selection: { academy: 'small', production: 'team', rentalInventory: 'starter', bogus: '' } } }, { selfService: true })
  assert.deepEqual(v.plan.modules, { academy: true, production: true, rentalInventory: true })
  assert.equal(v.plan.quote.subtotalMonthly, 49 + 69 + 129)
  assert.equal(v.plan.quote.discountRate, 0.2)
  assert.equal(v.plan.quote.monthly, 197.6)
  assert.equal(v.plan.quote.annual, 2371.2)
  assert.equal(v.plan.maxStudents, 50, 'students from the Academy plan')
  assert.equal(v.plan.planName, 'Rental & Inventory Starter + Production Team + Academy Small')
  const two = pr.quote({ academy: 'large', production: 'studio' })
  assert.equal(two.discountRate, 0)
  assert.equal(two.monthly, 598)
  assert.equal(two.annual, 7176)
  const self = ob.validateOrderInput({ ...valid, plan: { selection: { academy: 'small' }, maxStudents: 9999, storageQuotaGB: 999 } }, { selfService: true })
  assert.equal(self.plan.maxStudents, 50, "a customer can't raise their own limits")
  assert.equal(self.plan.storageQuotaGB, null)
  assert.equal(ob.validateOrderInput({ ...valid, plan: { selection: { academy: 'small' }, maxStudents: 80 } }, { selfService: false }).plan.maxStudents, 80, 'the superadmin can')
})
