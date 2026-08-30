/**
 * Creates three permanent test accounts (student / teacher / admin).
 * Safe to run multiple times — skips creation if the account already exists.
 *
 * Usage:
 *   node scripts/seed-test-accounts.mjs
 *
 * Requires scripts/serviceAccountKey.json to be present.
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(import.meta.url)
const admin     = require(join(__dirname, '../functions/node_modules/firebase-admin'))

const keyPath = join(__dirname, 'serviceAccountKey.json')
let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
} catch {
  console.error('❌  Service account key not found at scripts/serviceAccountKey.json')
  process.exit(1)
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const auth = admin.auth()
const db   = admin.firestore()

const ACCOUNTS = [
  {
    email:       'test-student@cineforge.app',
    password:    'TestStudent1!',
    displayName: 'Test Student',
    role:        'student',
    cohortId:    null,
  },
  {
    email:       'test-teacher@cineforge.app',
    password:    'TestTeacher1!',
    displayName: 'Test Teacher',
    role:        'teacher',
    cohortId:    null,
  },
  {
    email:       'test-admin@cineforge.app',
    password:    'TestAdmin1!',
    displayName: 'Test Admin',
    role:        'admin',
    cohortId:    null,
  },
]

async function upsertAccount({ email, password, displayName, role, cohortId }) {
  let uid
  try {
    const existing = await auth.getUserByEmail(email)
    uid = existing.uid
    console.log(`ℹ️  ${role}: auth account already exists (${uid})`)
  } catch {
    const user = await auth.createUser({ email, password, displayName, emailVerified: true })
    uid = user.uid
    console.log(`✅  ${role}: created auth account (${uid})`)
  }

  await auth.setCustomUserClaims(uid, { role, cohortId })

  await db.collection('users').doc(uid).set({
    uid,
    email,
    displayName,
    role,
    roles:          [role],
    avatarUrl:      null,
    cohortId,
    enrolledAt:     admin.firestore.FieldValue.serverTimestamp(),
    totalPoints:    0,
    pointsRedeemed: 0,
    isActive:       true,
  }, { merge: true })

  console.log(`   Firestore doc written, claims set → role: ${role}`)
  return { email, password, role }
}

async function run() {
  console.log('🎬  Seeding test accounts...\n')
  const results = []
  for (const account of ACCOUNTS) {
    results.push(await upsertAccount(account))
  }

  console.log('\n✅  All done. Test credentials:\n')
  console.log('  Role      Email                        Password')
  console.log('  ─────────────────────────────────────────────────────')
  for (const { role, email, password } of results) {
    console.log(`  ${role.padEnd(9)} ${email.padEnd(29)} ${password}`)
  }
  console.log('\n  Note: assign test-student to a cohort via Admin → User Manager.')
}

run().catch(err => {
  console.error('❌  Error:', err.message)
  process.exit(1)
})
