// Run with: node scripts/seed-school.mjs
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

initializeApp({ projectId: 'academy-hub-c252f' })
const db = getFirestore()

await db.collection('schools').doc('molkom').set({
  name: 'Molkom Folkhögskola',
  shortName: 'CineForge',
  logoUrl: null,
  primaryColor: '#f97316',
  subscriptionTier: 'beta',
  subscriptionStatus: 'active',
  maxStudents: 100,
  features: {
    videoLab: true,
    roomBooking: true,
    semesterWheel: true,
    sharePoint: false,
    gdpr: true,
  },
  contactEmail: 'fredrik.fridlund@regionvarmland.se',
  country: 'SE',
  timezone: 'Europe/Stockholm',
  createdAt: new Date(),
  isBeta: true,
}, { merge: true })

console.log('School document created')
process.exit(0)
