// Module gating in firestore.rules, against the Firestore emulator:
//   npm --prefix functions test
// The same request matrix (every module-owned path + core samples, as
// signed-out / student / teacher / admin, get/list/create/update/delete) is
// run with different schools/molkom docs and the results compared.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')
const DOCS = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`

// Module-owned paths (one sample document each), mirroring firestore.rules
const MODULE_PATHS = {
  academy: `lessons/x1 lessons/x1/attendance/x1 lessonCategories/x1 lessonBlocks/x1 classrooms/x1 subjects/x1
    subjects/x1/teachers/x1 assignments/x1 tests/x1 submissions/x1 checklists/x1 progress/x1 points_log/x1
    development_plans/x1 plan_comments/x1 teacher_assessments/x1 teacher_notes/x1 todos/x1 semester_events/x1
    semester_categories/x1 prizes/x1 prize_claims/x1 resource_folders/x1 team_resources/x1 videos/x1 video_lab/x1
    video_lab/x1/comments/x1 video_comments/x1/comments/x1 guest_teachers/x1 guest_teacher_bookings/x1
    attendance_sessions/x1 absence_reports/x1 qr_display_devices/x1 qr_display_devices/x1/live/x1
    qr_display_devices/x1/private/x1 rooms/x1 room_bookings/x1 room_slots/x1 time_blocks/x1 vehicles/x1
    minivan_bookings/x1 food_box_orders/x1 settings/booking settings/semester`.split(/\s+/),
  production: `productions/x1 productions/x1/scenes/x1 productions/x1/shootingDays/x1 productions/x1/shots/x1
    productions/x1/shotlog/x1 production_periods/x1 production_periods/x1/allocations/x1 settings/production`.split(/\s+/),
  rentalInventory: `equipment/x1 equipment_categories/x1 equipment_bookings/x1 equipment_bookings/x1/messages/x1
    inventory_presets/x1 inventory_projects/x1 inventory_projects/x1/items/x1 inventory_projects/x1/signatures/x1
    inventory_projects/x1/unit_out/x1 scan_sessions/x1 scan_sessions/x1/checkins/x1 settings/equipment_gtin
    settings/inventory_stats_resets`.split(/\s+/),
}
const SHARED = ['production_teams/x1', 'crew_roles/x1']
const CORE = ['users/emu-student', 'cohorts/x1', 'chat_channels/x1', 'notifications/x1', 'guide_articles/x1',
  'personal_events/x1', 'settings/nav_visibility', 'bug_reports/x1']
const ALL = [...Object.values(MODULE_PATHS).flat(), ...SHARED, ...CORE]

function token(uid, role) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const t = Math.floor(Date.now() / 1000)
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid,
    iat: t, exp: t + 3600, auth_time: t, role, email_verified: true, email: `${uid}@example.test`,
    firebase: { sign_in_provider: 'password' },
  })}.`
}
const WHO = { anon: null, student: token('emu-student', 'student'), teacher: token('emu-teacher', 'teacher'), admin: token('emu-admin', 'admin') }
const str = v => ({ stringValue: v })
// A body that satisfies the common ownership checks, so writes reach the module condition
const body = uid => ({ fields: { uid: str(uid), studentId: str(uid), userId: str(uid), createdBy: str(uid), name: str('x'), title: str('x'), status: str('pending') } })

async function call(method, url, bearer, payload) {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  return res.status
}
const owner = (method, path, payload) => call(method, `${DOCS}/${path}`, 'owner', payload)

async function seed(schoolFields) {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await owner('PATCH', 'schools/molkom', { fields: { name: str('Test'), ...schoolFields } })
  for (const [uid, role] of [['emu-student', 'student'], ['emu-teacher', 'teacher'], ['emu-admin', 'admin']]) {
    await owner('PATCH', `users/${uid}`, { fields: { uid: str(uid), role: str(role), displayName: str(uid) } })
  }
  for (const p of ALL) if (!p.startsWith('users/')) await owner('PATCH', p, body('emu-student'))
}

// Result of every request in the matrix, keyed "who op path"
async function matrix(paths = ALL) {
  const out = {}
  for (const [who, bearer] of Object.entries(WHO)) {
    const uid = who === 'anon' ? 'anon' : `emu-${who}`
    for (const p of paths) {
      const parent = p.split('/').slice(0, -1).join('/')
      out[`${who} get ${p}`]    = await call('GET', `${DOCS}/${p}`, bearer)
      out[`${who} list ${p}`]   = await call('GET', `${DOCS}/${parent}`, bearer)
      out[`${who} update ${p}`] = await call('PATCH', `${DOCS}/${p}?updateMask.fieldPaths=title`, bearer, { fields: { title: str('y') } })
      // Fixed-id documents (settings/booking …) are created under their own
      // id — a new random id would be a different, ungated document
      const fixedId = !p.endsWith('/x1') && !p.startsWith('users/')
      const createId = fixedId ? p.split('/').pop() : `new-${who}`
      if (fixedId) await owner('DELETE', p)
      out[`${who} create ${p}`] = await call('POST', `${DOCS}/${parent}?documentId=${createId}`, bearer, body(uid))
      out[`${who} delete ${p}`] = await call('DELETE', `${DOCS}/${p}`, bearer)
      // put the sample back for the next identity
      await owner('PATCH', p, p.startsWith('users/') ? { fields: { uid: str('emu-student'), role: str('student'), displayName: str('emu-student') } } : body('emu-student'))
      if (!fixedId) await owner('DELETE', `${parent}/new-${who}`)
    }
  }
  return out
}

const LEGACY = { tier: str('studio'), productType: str('education') }
const modules = (academy, production, rentalInventory) => ({
  ...LEGACY,
  modules: { mapValue: { fields: { academy: { booleanValue: academy }, production: { booleanValue: production }, rentalInventory: { booleanValue: rentalInventory } } } },
})

let legacy
before(async () => {
  await seed(LEGACY)
  legacy = await matrix()
})

test('legacy school (no modules field): sanity — the matrix exercises real access', () => {
  const allowed = Object.values(legacy).filter(s => s === 200).length
  assert.ok(allowed > 50, `expected many allowed requests in the legacy matrix, got ${allowed}`)
})

// Optional: BASELINE_RULES=<path to older firestore.rules> proves a legacy
// school gets byte-for-byte the same answers under the old rules
test('legacy school: identical results under the baseline rules', { skip: !process.env.BASELINE_RULES }, async () => {
  const load = content => fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  })
  await load(readFileSync(process.env.BASELINE_RULES, 'utf-8'))
  try {
    await seed(LEGACY)
    const baseline = await matrix()
    const diffs = Object.keys(legacy).filter(k => baseline[k] !== legacy[k]).map(k => `${k}: baseline ${baseline[k]}, now ${legacy[k]}`)
    assert.deepEqual(diffs, [], 'requests whose result changed')
  } finally {
    await load(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf-8'))
  }
})

test('all modules on behaves exactly like a legacy school', async () => {
  await seed(modules(true, true, true))
  assert.deepEqual(await matrix(), legacy)
})

for (const [module, label] of [['academy', 'Academy'], ['production', 'Production'], ['rentalInventory', 'Rental & Inventory']]) {
  test(`${label} off: every request to its collections is denied, even for admins; nothing else changes`, async () => {
    await seed(modules(module !== 'academy', module !== 'production', module !== 'rentalInventory'))
    const result = await matrix()
    for (const [key, status] of Object.entries(result)) {
      const [, op, path] = key.split(' ')
      if (op === 'list' && path.startsWith('settings/')) {
        // Listing settings can't be checked per document: refused while any module is off
        assert.equal(status, 403, `${key} (settings list) should be denied with ${label} off`)
      } else if (MODULE_PATHS[module].includes(path)) {
        assert.equal(status, 403, `${key} should be denied with ${label} off`)
      } else if (!SHARED.includes(path)) {
        assert.equal(status, legacy[key], `${key} must not change when ${label} is off`)
      }
    }
  })
}

test('production off: admins cannot read or write productions', async () => {
  await seed(modules(true, false, true))
  for (const p of MODULE_PATHS.production) {
    assert.equal(await call('GET', `${DOCS}/${p}`, WHO.admin), 403, `admin get ${p}`)
    assert.equal(await call('PATCH', `${DOCS}/${p}?updateMask.fieldPaths=title`, WHO.admin, { fields: { title: str('y') } }), 403, `admin update ${p}`)
  }
})

test('shared collections: team reads stay core; crew roles readable with Production or Rental', async () => {
  await seed(modules(true, false, true))
  assert.equal(await call('GET', `${DOCS}/production_teams/x1`, WHO.student), legacy['student get production_teams/x1'], 'team read with Production off')
  assert.equal(await call('PATCH', `${DOCS}/production_teams/x1?updateMask.fieldPaths=title`, WHO.admin, { fields: { title: str('y') } }), 403, 'team write with Production off')
  assert.equal(await call('GET', `${DOCS}/crew_roles/x1`, WHO.student), 200, 'crew roles readable via Rental')
  await seed(modules(true, false, false))
  assert.equal(await call('GET', `${DOCS}/crew_roles/x1`, WHO.student), 403, 'crew roles with both off')
})

// ── Public shop and audit log ────────────────────────────────────────────────

const shopRequests = async () => ({
  categories: await call('GET', `${DOCS}/equipment_categories`, null),
  equipment:  await call('GET', `${DOCS}/equipment/x1`, null),
  guestBooking: await call('POST', `${DOCS}/equipment_bookings?documentId=guest-1`, null, { fields: {
    status: str('pending'), guestEmail: str('guest@example.org'), isGuest: { booleanValue: true }, studentId: str(''),
  } }),
})

test('public shop: legacy schools exactly as before — open only in rental mode', async () => {
  await seed(LEGACY)
  assert.deepEqual(Object.values(await shopRequests()), [403, 403, 403], 'education school: closed')
  await seed({ tier: str('rental'), productType: str('rental') })
  assert.deepEqual(await shopRequests(), { categories: 200, equipment: 200, guestBooking: 200 }, 'rental mode: open')
})

test('public shop: module-based schools are closed until publicShop is switched on', async () => {
  const rentalOnly = modules(false, false, true)
  await seed(rentalOnly)
  assert.deepEqual(Object.values(await shopRequests()), [403, 403, 403], 'default: closed')
  await seed({ ...rentalOnly, publicShop: { booleanValue: true } })
  assert.deepEqual(await shopRequests(), { categories: 200, equipment: 200, guestBooking: 200 }, 'switched on: open')
  await seed({ ...modules(true, true, false), publicShop: { booleanValue: true } })
  assert.deepEqual(Object.values(await shopRequests()), [403, 403, 403], 'flag without Rental & Inventory: closed')
})

test('school_audit: readable only by the superadmin, writable by nobody', async () => {
  await seed(LEGACY)
  await owner('PATCH', 'school_audit/a1', { fields: { schoolId: str('molkom') } })
  const superadmin = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf-8').match(/email in \['([^']+)'/)[1]
  const su = (() => { const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const t = Math.floor(Date.now() / 1000)
    return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'su', user_id: 'su', iat: t, exp: t + 3600, auth_time: t, role: 'admin', email: superadmin, email_verified: true, firebase: { sign_in_provider: 'password' } })}.` })()
  assert.equal(await call('GET', `${DOCS}/school_audit/a1`, su), 200, 'superadmin read')
  assert.equal(await call('GET', `${DOCS}/school_audit/a1`, WHO.admin), 403, 'school admin read')
  assert.equal(await call('GET', `${DOCS}/school_audit/a1`, null), 403, 'signed-out read')
  assert.equal(await call('PATCH', `${DOCS}/school_audit/a1?updateMask.fieldPaths=schoolId`, su, { fields: { schoolId: str('x') } }), 403, 'superadmin write')
})
