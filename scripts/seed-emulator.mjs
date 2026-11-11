// Test accounts for the local emulators (never a real project):
//   firebase emulators:start --only auth,firestore,functions --project demo-cineforge
//   node scripts/seed-emulator.mjs
// Then `npx vite --mode emulator` and sign in with one of the accounts below.
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-cineforge'
if (!projectId.startsWith('demo-')) throw new Error('Refusing to seed a non-demo project')
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'

initializeApp({ projectId })
const auth = getAuth()
const db = getFirestore()

const PASSWORD = 'emulator-only-pw'
const accounts = [
  { uid: 'emu-admin',   email: 'admin@example.test',   displayName: 'Emulator Admin',   role: 'admin' },
  { uid: 'emu-teacher', email: 'teacher@example.test', displayName: 'Emulator Teacher', role: 'teacher' },
  { uid: 'emu-student', email: 'student@example.test', displayName: 'Emulator Student', role: 'student' },
]

// The deployment's school, configured like production today: legacy tier, no modules
await db.collection('schools').doc('molkom').set({ name: 'Molkom (emulator)', shortName: 'Molkom', tier: 'studio', productType: 'education', isBeta: true, maxStudents: 100 })

for (const a of accounts) {
  await auth.deleteUser(a.uid).catch(() => {})
  await auth.createUser({ uid: a.uid, email: a.email, password: PASSWORD, displayName: a.displayName, emailVerified: true })
  await auth.setCustomUserClaims(a.uid, { role: a.role, roles: [a.role] })
  await db.collection('users').doc(a.uid).set({
    uid: a.uid, email: a.email, displayName: a.displayName, role: a.role, roles: [a.role],
    isActive: true, schoolEmail: a.email, avatarUrl: '/fire.png', hasSeenWelcome: true, gdprConsent: { given: true, at: new Date() },
  })
  console.log(`${a.role.padEnd(7)} ${a.email}`)
}
console.log(`password for all: see PASSWORD in ${new URL(import.meta.url).pathname}`)
