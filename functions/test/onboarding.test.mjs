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
  plan: { planName: 'Academy', modules: { academy: true, production: false, rentalInventory: true }, maxStudents: 200 },
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
  bad({ plan: { modules: { academy: false, production: false, rentalInventory: false } } })
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
  await assert.rejects(ob.cancelOrder(id, boss), e => /offboarding/.test(e.message), 'live orders are not cancelled')

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
