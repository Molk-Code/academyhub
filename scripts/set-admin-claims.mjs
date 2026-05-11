/**
 * Sets role: 'admin' custom claims on an existing Firebase Auth account
 * so that Firestore security rules can verify the role via the JWT token.
 *
 * Usage:
 *   1. Ensure scripts/serviceAccountKey.json exists
 *      (Firebase Console → Project Settings → Service Accounts → Generate new private key)
 *   2. Run:  node scripts/set-admin-claims.mjs
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(import.meta.url)
const admin     = require(join(__dirname, '../functions/node_modules/firebase-admin'))

const EMAIL = 'fredrik.fridlund@regionvarmland.se'

const keyPath = join(__dirname, 'serviceAccountKey.json')
let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
} catch {
  console.error('❌  Service account key not found at scripts/serviceAccountKey.json')
  process.exit(1)
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })

async function run() {
  const user = await admin.auth().getUserByEmail(EMAIL)
  console.log(`Found user: ${user.uid}`)
  console.log(`Current claims: ${JSON.stringify(user.customClaims)}`)

  await admin.auth().setCustomUserClaims(user.uid, {
    role: 'admin',
    cohortId: null,
  })
  console.log(`✅  Claims updated to: { role: 'admin', cohortId: null }`)

  // Also ensure Firestore doc has role: 'admin'
  await admin.firestore().collection('users').doc(user.uid).update({
    role:  'admin',
    roles: ['admin', 'teacher'],
  })
  console.log(`✅  Firestore user doc updated`)

  console.log('\n⚠️  Sign out and back in to the app to pick up the new token claims.')
}

run().catch(err => {
  console.error('❌', err.message)
  process.exit(1)
})
