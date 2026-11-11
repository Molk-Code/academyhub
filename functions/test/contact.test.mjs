// Contact form tests, run against the Firestore emulator (with firestore.rules):
//   npm --prefix functions test
// Needs Java for the emulator. Uses the demo-cineforge project id, so nothing
// here can reach a real Firebase project.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST, 'FIRESTORE_EMULATOR_HOST is not set — run via `firebase emulators:exec` (npm test)')
assert.ok(PROJECT.startsWith('demo-'), 'tests must run against a demo- project')

const { db, admin } = await import('../lib/lib.js')
const contact = await import('../lib/contact.js')
const { handleContactRequest, purgeContactRequests, validateContact, CONTACT_RETENTION_MONTHS } = contact

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.org',
  organisation: 'Example School',
  category: 'school_enquiry',
  message: 'Hello, we would like to know more about CineForge.',
}

function mailer({ fail = false } = {}) {
  const sent = []
  return {
    sent,
    deps: {
      notifyEmail: 'contact@example.test',
      sendEmail: async msg => { sent.push(msg); if (fail) throw new Error('simulated email outage') },
    },
  }
}
const meta = (ip = '203.0.113.7') => ({ ip, userAgent: 'test-agent/1.0 ' + 'x'.repeat(300) })
const requests = async () => (await db.collection('contact_requests').get()).docs
async function rejects(promise, code) {
  await assert.rejects(promise, err => err?.code === code || err?.httpErrorCode?.canonicalName === code.toUpperCase().replace('-', '_') || String(err?.code).endsWith(code))
}

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
})

test('a valid request is stored, hashed and emailed with escaped content', async () => {
  const m = mailer()
  const res = await handleContactRequest({ ...valid, message: 'Hi <script>alert(1)</script> & welcome' }, meta(), m.deps)
  assert.deepEqual(res, { ok: true })

  const docs = await requests()
  assert.equal(docs.length, 1)
  const d = docs[0].data()
  assert.equal(d.name, valid.name)
  assert.equal(d.email, valid.email)
  assert.equal(d.organisation, valid.organisation)
  assert.equal(d.category, 'school_enquiry')
  assert.equal(d.status, 'new')
  assert.ok(d.createdAt instanceof admin.firestore.Timestamp)
  assert.match(d.ipHash, /^[0-9a-f]{64}$/)
  assert.equal(d.userAgent.length, 200)
  assert.ok(!JSON.stringify(d).includes('203.0.113.7'), 'raw IP must never be stored')

  assert.equal(m.sent.length, 1)
  const mail = m.sent[0]
  assert.deepEqual(mail.to, ['contact@example.test'])
  assert.equal(mail.replyTo, valid.email)
  assert.ok(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; welcome'))
  assert.ok(!mail.html.includes('<script>'))
  assert.ok(!/[\r\n]/.test(mail.subject))
})

test('the honeypot field makes it succeed silently without storing or emailing', async () => {
  const m = mailer()
  const res = await handleContactRequest({ ...valid, website: 'http://spam.example' }, meta(), m.deps)
  assert.deepEqual(res, { ok: true })
  assert.equal((await requests()).length, 0)
  assert.equal(m.sent.length, 0)
})

test('oversize or malformed input is rejected with invalid-argument', async () => {
  const cases = {
    'name > 120':          { name: 'n'.repeat(121) },
    'empty name':          { name: '   ' },
    'email > 200':         { email: 'a'.repeat(190) + '@example.org' },
    'invalid email':       { email: 'not-an-email' },
    'organisation > 200':  { organisation: 'o'.repeat(201) },
    'organisation number': { organisation: 42 },
    'message < 10':        { message: 'too short' },
    'message > 4000':      { message: 'm'.repeat(4001) },
    'unknown category':    { category: 'marketing' },
  }
  for (const [label, patch] of Object.entries(cases)) {
    assert.throws(() => validateContact({ ...valid, ...patch }), err => err.code === 'invalid-argument', label)
    await rejects(handleContactRequest({ ...valid, ...patch }, meta(), mailer().deps), 'invalid-argument')
  }
  assert.equal((await requests()).length, 0)
  // Limits are inclusive
  assert.doesNotThrow(() => validateContact({ ...valid, name: 'n'.repeat(120), message: 'm'.repeat(4000), organisation: 'o'.repeat(200) }))
})

test('the 6th request from one IP within an hour is rejected', async () => {
  for (let i = 0; i < 5; i++) await handleContactRequest(valid, meta('198.51.100.1'), mailer().deps)
  await rejects(handleContactRequest(valid, meta('198.51.100.1'), mailer().deps), 'resource-exhausted')
  assert.equal((await requests()).length, 5)
  // Another address is still allowed
  await handleContactRequest(valid, meta('198.51.100.2'), mailer().deps)
  assert.equal((await requests()).length, 6)
})

test('more than 20 requests per hour in total are rejected', async () => {
  for (let i = 0; i < 20; i++) await handleContactRequest(valid, meta(`192.0.2.${i}`), mailer().deps)
  await rejects(handleContactRequest(valid, meta('192.0.2.200'), mailer().deps), 'resource-exhausted')
  assert.equal((await requests()).length, 20)
})

test('an email failure keeps the stored request and still returns ok', async () => {
  const m = mailer({ fail: true })
  const res = await handleContactRequest(valid, meta(), m.deps)
  assert.deepEqual(res, { ok: true })
  assert.equal(m.sent.length, 1)
  assert.equal((await requests()).length, 1)
})

test('a missing CONTACT_NOTIFY_EMAIL keeps the request (and logs) instead of failing', async () => {
  const m = mailer()
  const res = await handleContactRequest(valid, meta(), { ...m.deps, notifyEmail: undefined })
  assert.deepEqual(res, { ok: true })
  assert.equal(m.sent.length, 0)
  assert.equal((await requests()).length, 1)
})

test('purge deletes requests past retention except those on legal hold', async () => {
  const now = new Date('2027-06-15T12:00:00Z')
  const ago = months => { const d = new Date(now); d.setMonth(d.getMonth() - months); return admin.firestore.Timestamp.fromDate(d) }
  const col = db.collection('contact_requests')
  await col.doc('old').set({ ...valid, status: 'answered', createdAt: ago(CONTACT_RETENTION_MONTHS + 1) })
  await col.doc('old-hold').set({ ...valid, status: 'legal-hold', createdAt: ago(CONTACT_RETENTION_MONTHS + 6) })
  await col.doc('recent').set({ ...valid, status: 'new', createdAt: ago(CONTACT_RETENTION_MONTHS - 1) })
  await db.collection('rate_limits').doc('ip_abc_contact').set({ n: 1, t: now.getTime() - 3 * 3600_000 })
  await db.collection('rate_limits').doc('someuid_pdf').set({ n: 1, t: 0 })

  const res = await purgeContactRequests(now)
  assert.deepEqual(res, { deleted: 1, kept: 1 })
  assert.deepEqual((await requests()).map(d => d.id).sort(), ['old-hold', 'recent'])
  assert.equal((await db.collection('rate_limits').doc('ip_abc_contact').get()).exists, false)
  assert.equal((await db.collection('rate_limits').doc('someuid_pdf').get()).exists, true, 'other rate limits are untouched')
})

test('the privacy policy retention matches the purge constant', () => {
  const legalTs = readFileSync(new URL('../../src/config/legal.ts', import.meta.url), 'utf-8')
  const m = legalTs.match(/contactRetentionMonths:\s*(\d+)/)
  assert.ok(m, 'contactRetentionMonths not found in src/config/legal.ts')
  assert.equal(Number(m[1]), CONTACT_RETENTION_MONTHS)
})

// ── firestore.rules ───────────────────────────────────────────────────────────

// Unsigned token the emulator accepts for rules evaluation
function token(uid, role) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const t = Math.floor(Date.now() / 1000)
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid,
    iat: t, exp: t + 3600, auth_time: t, role, firebase: { sign_in_provider: 'password' },
  })}.`
}
const DOCS = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`
async function asUser(method, path, bearer, body) {
  const res = await fetch(`${DOCS}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.status
}
const fields = { fields: { name: { stringValue: 'x' }, status: { stringValue: 'new' } } }

test('rules: signed-out users cannot read or write contact_requests', async () => {
  await db.collection('contact_requests').doc('r1').set({ ...valid, status: 'new' })
  assert.equal(await asUser('GET', 'contact_requests', null), 403, 'list')
  assert.equal(await asUser('GET', 'contact_requests/r1', null), 403, 'get')
  assert.equal(await asUser('POST', 'contact_requests', null, fields), 403, 'create')
  assert.equal(await asUser('PATCH', 'contact_requests/r1', null, fields), 403, 'update')
  assert.equal(await asUser('DELETE', 'contact_requests/r1', null), 403, 'delete')
})

test('rules: students and teachers cannot read or write; admins can read/update/delete but not create', async () => {
  await db.collection('contact_requests').doc('r1').set({ ...valid, status: 'new' })
  for (const role of ['student', 'teacher']) {
    const t = token(`${role}-1`, role)
    assert.equal(await asUser('GET', 'contact_requests', t), 403, `${role} list`)
    assert.equal(await asUser('GET', 'contact_requests/r1', t), 403, `${role} get`)
    assert.equal(await asUser('POST', 'contact_requests', t, fields), 403, `${role} create`)
    assert.equal(await asUser('PATCH', 'contact_requests/r1', t, fields), 403, `${role} update`)
    assert.equal(await asUser('DELETE', 'contact_requests/r1', t), 403, `${role} delete`)
  }
  const a = token('admin-1', 'admin')
  assert.equal(await asUser('GET', 'contact_requests', a), 200, 'admin list')
  assert.equal(await asUser('POST', 'contact_requests', a, fields), 403, 'admin create (function-only)')
  assert.equal(await asUser('PATCH', 'contact_requests/r1?updateMask.fieldPaths=status', a, { fields: { status: { stringValue: 'answered' } } }), 200, 'admin update')
  assert.equal(await asUser('DELETE', 'contact_requests/r1', a), 200, 'admin delete')
})

test('rules: the IP salt and rate-limit counters are not readable by clients', async () => {
  await handleContactRequest(valid, meta(), mailer().deps)
  const a = token('admin-1', 'admin')
  assert.equal(await asUser('GET', 'private_config/contact', a), 403, 'salt, even for admins')
  assert.equal(await asUser('GET', 'private_config/contact', null), 403, 'salt, signed out')
  assert.equal(await asUser('GET', 'rate_limits', null), 403, 'rate limits')
})
