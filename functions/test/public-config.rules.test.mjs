// public_config (login page profile) rules, against the Firestore emulator:
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')
const DOCS = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`

// The superadmin address lives in firestore.rules (isSuperAdmin); read it
// from there rather than repeating it here
const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf-8')
const SUPERADMIN = rules.match(/function isSuperAdmin\(\)[\s\S]*?email in \['([^']+)'/)?.[1]
assert.ok(SUPERADMIN, 'could not find the superadmin address in firestore.rules')

function token(uid, role, email) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const t = Math.floor(Date.now() / 1000)
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid,
    iat: t, exp: t + 3600, auth_time: t, role, email, email_verified: true, firebase: { sign_in_provider: 'password' },
  })}.`
}
const call = (method, path, bearer, body) => fetch(`${DOCS}/${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(r => r.status)
const doc = { fields: { name: { stringValue: 'Test' }, frontDoor: { stringValue: 'academy' } } }

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  for (const [uid, role] of [['emu-student', 'student'], ['emu-admin', 'admin']]) {
    await call('PATCH', `users/${uid}`, 'owner', { fields: { role: { stringValue: role } } })
  }
})

test('anyone, signed out included, can read the login profile', async () => {
  assert.equal(await call('GET', 'public_config/main', null), 404, 'missing doc: readable, just not there')
  await call('PATCH', 'public_config/main', 'owner', doc)
  assert.equal(await call('GET', 'public_config/main', null), 200)
  assert.equal(await call('GET', 'public_config/main', token('emu-student', 'student', 'student@example.test')), 200)
})

test('only the superadmin can write it — not signed-out users, students or school admins', async () => {
  const path = 'public_config/main?updateMask.fieldPaths=name&updateMask.fieldPaths=frontDoor'
  assert.equal(await call('PATCH', path, null, doc), 403, 'signed out')
  assert.equal(await call('PATCH', path, token('emu-student', 'student', 'student@example.test'), doc), 403, 'student')
  assert.equal(await call('PATCH', path, token('emu-admin', 'admin', 'admin@example.test'), doc), 403, 'school admin')
  assert.equal(await call('PATCH', path, token('emu-super', 'admin', SUPERADMIN), doc), 200, 'superadmin')
  assert.equal(await call('DELETE', 'public_config/main', token('emu-admin', 'admin', 'admin@example.test')), 403, 'admin delete')
})
