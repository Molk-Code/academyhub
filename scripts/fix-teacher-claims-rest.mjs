// Uses firebase-tools stored refresh token to call Firebase Auth REST API directly.
// No service account needed — just requires firebase CLI to be logged in.
import { readFileSync } from 'fs'
import { homedir } from 'os'

const PROJECT_ID   = 'academy-hub-c252f'
const CLIENT_ID    = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'

// 1. Load refresh token from firebase CLI config
const cliConfig   = JSON.parse(readFileSync(`${homedir()}/.config/configstore/firebase-tools.json`, 'utf8'))
const refreshToken = cliConfig.tokens.refresh_token

// 2. Exchange for a fresh access token
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  }),
})
const tokenData = await tokenRes.json()
if (!tokenData.access_token) {
  console.error('Failed to get access token:', tokenData)
  process.exit(1)
}
const accessToken = tokenData.access_token
console.log('Got fresh access token.\n')

// 3. Fetch all users from Firestore via REST
const fsRes = await fetch(
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'role' },
            op: 'IN',
            value: { arrayValue: { values: [{ stringValue: 'teacher' }, { stringValue: 'admin' }] } },
          },
        },
      },
    }),
  },
)
const fsData = await fsRes.json()
const docs = fsData.filter(r => r.document).map(r => ({
  uid:  r.document.name.split('/').pop(),
  role: r.document.fields?.role?.stringValue ?? null,
}))
console.log(`Found ${docs.length} teacher/admin users in Firestore.\n`)

// 4. For each user, inspect and fix claims via Identity Toolkit REST API
const results = []

for (const { uid, role } of docs) {
  // Get user record via lookup
  const getUserRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: [uid] }),
    },
  )
  const userData = await getUserRes.json()
  const user = (userData.users ?? [])[0]

  if (!user) {
    console.log(`   SKIP  uid=${uid} — not found in Auth`)
    continue
  }

  let claims = {}
  try { claims = JSON.parse(user.customAttributes || '{}') } catch { claims = {} }

  const claimCohortId = claims.cohortId ?? null
  results.push({ email: user.email, uid, firestoreRole: role, claimRole: claims.role ?? null, claimCohortId, fixed: false })

  if (claimCohortId !== null) {
    const newClaims = { ...claims, cohortId: null }
    const patchRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(newClaims) }),
      },
    )
    const patchData = await patchRes.json()
    if (patchData.localId) {
      results[results.length - 1].fixed = true
      console.log(`✅ FIXED  ${user.email}  — removed stale cohortId: "${claimCohortId}"`)
    } else {
      console.log(`❌ ERROR  ${user.email}  — patch failed:`, JSON.stringify(patchData))
    }
  } else {
    console.log(`   OK     ${user.email}  — cohortId claim already null`)
  }
}

const fixed = results.filter(r => r.fixed).length
console.log(`\nDone. Scanned: ${results.length}, Fixed: ${fixed}`)
console.table(results.map(r => ({
  email:         r.email,
  claimRole:     r.claimRole,
  claimCohortId: r.claimCohortId,
  fixed:         r.fixed,
})))
