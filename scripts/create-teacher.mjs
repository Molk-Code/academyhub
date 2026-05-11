/**
 * Creates a teacher account directly via the Admin SDK.
 *
 * Usage:
 *   1. Download a service account key from Firebase Console →
 *      Project Settings → Service Accounts → Generate new private key
 *   2. Save it as  scripts/serviceAccountKey.json
 *   3. Run:  node scripts/create-teacher.mjs
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(import.meta.url)

const admin = require(join(__dirname, '../functions/node_modules/firebase-admin'))

// ── Config ────────────────────────────────────────────────────────────────────
const TEACHER_EMAIL    = 'fredrik.fridlund@regionvarmland.se'
const TEACHER_PASSWORD = 'Test2024!'
const TEACHER_NAME     = 'Fredrik Fridlund'
// ─────────────────────────────────────────────────────────────────────────────

const keyPath = join(__dirname, 'serviceAccountKey.json')
let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
} catch {
  console.error('❌  Service account key not found.')
  console.error(`    Download it from Firebase Console → Project Settings → Service Accounts`)
  console.error(`    and save it to:  scripts/serviceAccountKey.json`)
  process.exit(1)
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const auth = admin.auth()
const db   = admin.firestore()

async function run() {
  // 1. Create or fetch the Auth user
  let uid
  try {
    const existing = await auth.getUserByEmail(TEACHER_EMAIL)
    uid = existing.uid
    console.log(`ℹ️  Auth user already exists (${uid}) — skipping creation`)
  } catch {
    const user = await auth.createUser({
      email:        TEACHER_EMAIL,
      password:     TEACHER_PASSWORD,
      displayName:  TEACHER_NAME,
      emailVerified: true,
    })
    uid = user.uid
    console.log(`✅  Created Auth user: ${uid}`)
  }

  // 2. Set custom claims (role in JWT — needed by Firestore rules)
  await auth.setCustomUserClaims(uid, { role: 'teacher', cohortId: null })
  console.log(`✅  Custom claims set: { role: 'teacher', cohortId: null }`)

  // 3. Create / merge Firestore user document
  await db.collection('users').doc(uid).set({
    uid,
    email:          TEACHER_EMAIL,
    displayName:    TEACHER_NAME,
    role:           'teacher',
    roles:          ['teacher'],
    avatarUrl:      null,
    cohortId:       null,
    enrolledAt:     admin.firestore.FieldValue.serverTimestamp(),
    totalPoints:    0,
    pointsRedeemed: 0,
    isActive:       true,
  }, { merge: true })
  console.log(`✅  Firestore user doc written to users/${uid}`)

  console.log('\n🎉  Done! You can now log in with:')
  console.log(`    Email:    ${TEACHER_EMAIL}`)
  console.log(`    Password: ${TEACHER_PASSWORD}`)
  console.log('\n    After first login, force a token refresh by signing out and back in.')
}

run().catch(err => {
  console.error('❌  Error:', err.message)
  process.exit(1)
})
