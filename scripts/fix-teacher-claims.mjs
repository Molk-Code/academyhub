import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

if (!getApps().length) {
  initializeApp({ projectId: 'academy-hub-c252f' })
}

const auth = getAuth()
const db   = getFirestore()

const snap = await db.collection('users')
  .where('role', 'in', ['teacher', 'admin'])
  .get()

console.log(`Found ${snap.size} teacher/admin users in Firestore.\n`)

const results = []

for (const docSnap of snap.docs) {
  const uid    = docSnap.id
  const fsData = docSnap.data()

  let userRecord
  try { userRecord = await auth.getUser(uid) } catch { continue }

  const claims        = userRecord.customClaims ?? {}
  const claimCohortId = claims.cohortId ?? null

  results.push({
    email:         userRecord.email,
    uid,
    firestoreRole: fsData.role,
    claimRole:     claims.role     ?? null,
    claimCohortId,
    fixed: false,
  })

  if (claimCohortId !== null) {
    await auth.setCustomUserClaims(uid, { ...claims, cohortId: null })
    results[results.length - 1].fixed = true
    console.log(`✅ FIXED  ${userRecord.email}  — removed stale cohortId: "${claimCohortId}"`)
  } else {
    console.log(`   OK     ${userRecord.email}  — cohortId claim already null`)
  }
}

const fixed = results.filter(r => r.fixed).length
console.log(`\nDone. Scanned: ${results.length}, Fixed: ${fixed}`)
console.log('\nFull report:')
console.table(results.map(r => ({
  email:         r.email,
  claimRole:     r.claimRole,
  claimCohortId: r.claimCohortId,
  fixed:         r.fixed,
})))
