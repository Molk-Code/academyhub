import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(import.meta.url)

const admin = require(join(__dirname, '../functions/node_modules/firebase-admin'))

const STUDENT_EMAIL    = 'hej@fredrikfridlund.se'
const STUDENT_PASSWORD = 'Test2024!'
const STUDENT_NAME     = 'Fredrik Fridlund'

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

async function run() {
  let uid
  try {
    const existing = await auth.getUserByEmail(STUDENT_EMAIL)
    uid = existing.uid
    console.log(`ℹ️  Auth user already exists (${uid}) — skipping creation`)
  } catch {
    const user = await auth.createUser({
      email:         STUDENT_EMAIL,
      password:      STUDENT_PASSWORD,
      displayName:   STUDENT_NAME,
      emailVerified: true,
    })
    uid = user.uid
    console.log(`✅  Created Auth user: ${uid}`)
  }

  await auth.setCustomUserClaims(uid, { role: 'student', cohortId: null })
  console.log(`✅  Custom claims set: { role: 'student', cohortId: null }`)

  await db.collection('users').doc(uid).set({
    uid,
    email:          STUDENT_EMAIL,
    displayName:    STUDENT_NAME,
    role:           'student',
    roles:          ['student'],
    avatarUrl:      null,
    cohortId:       null,
    enrolledAt:     admin.firestore.FieldValue.serverTimestamp(),
    totalPoints:    0,
    pointsRedeemed: 0,
    isActive:       true,
  }, { merge: true })
  console.log(`✅  Firestore user doc written to users/${uid}`)

  console.log('\n🎉  Done! Log in with:')
  console.log(`    Email:    ${STUDENT_EMAIL}`)
  console.log(`    Password: ${STUDENT_PASSWORD}`)
  console.log('\n    Assign to a cohort via Admin → User Manager after first login.')
}

run().catch(err => {
  console.error('❌  Error:', err.message)
  process.exit(1)
})
