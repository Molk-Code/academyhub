import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, 'serviceAccountKey.json'))

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// Check if already seeded
const existing = await db.collection('guide_sections').get()
if (!existing.empty) {
  console.log('FAQ already has content — skipping seed')
  process.exit(0)
}

const sections = [
  { id: 'getting-started', title: 'Getting Started', icon: '🚀', order: 1 },
  { id: 'production',      title: 'Production',      icon: '🎬', order: 2 },
  { id: 'equipment',       title: 'Equipment',        icon: '📷', order: 3 },
  { id: 'rules',           title: 'School Rules',     icon: '📋', order: 4 },
]

const articles = [
  {
    sectionId: 'getting-started', title: 'Welcome to CineForge', order: 1,
    body: 'CineForge is your filmmaking education portal. Here you can check your schedule, book equipment, plan productions, and track your progress.\n\nYour teacher will guide you through the key features during the first week.',
  },
  {
    sectionId: 'getting-started', title: 'Installing the app on your phone', order: 2,
    body: '**iPhone:** Open Safari → tap the Share button → tap "Add to Home Screen"\n\n**Android:** Open Chrome → tap the ⋮ menu → tap "Add to Home Screen"\n\nInstalling gives you push notifications for new assignments, bookings, and messages.',
  },
  {
    sectionId: 'getting-started', title: 'How attendance and points work', order: 3,
    body: 'Attend each lesson by scanning the QR code your teacher shows at the start of class. Each check-in earns you **+5 points**.\n\nIf you cannot attend, report your absence in the Check In page before the lesson. Self-reported absence earns 0 points. Teacher-registered absence costs −5 points.',
  },
  {
    sectionId: 'production', title: 'Starting a production', order: 1,
    body: 'Go to **Production** in the menu and click **New Production**.\n\nBefore you can book equipment your production needs:\n- Script Breakdown (at least 1 scene)\n- Crew (at least 1 crew member assigned)\n- Cast (at least 1 cast member)\n- Locations (at least 1 location)\n- Schedule (at least 1 shooting day with scenes assigned)\n\nOnce all five are complete, equipment booking is unlocked.',
  },
  {
    sectionId: 'production', title: 'Booking equipment for your production', order: 2,
    body: 'Go to **Booking → Equipment**. Select your production from the list — it must have a complete plan.\n\nAdd items to your cart and submit a booking request. Your teacher will confirm or deny within 24 hours. You will receive a push notification when your request is reviewed.',
  },
  {
    sectionId: 'equipment', title: 'Checking out equipment', order: 1,
    body: 'Collect equipment from the equipment room at your confirmed checkout time. Bring your student ID.\n\nAll items must be returned clean and complete with all accessories by your return date. Late returns affect your standing for future bookings.',
  },
  {
    sectionId: 'equipment', title: 'Reporting damaged or missing items', order: 2,
    body: 'Report any damage or loss to your teacher **immediately** — do not attempt to hide or repair damage yourself.\n\nMark items as damaged or missing through the equipment return process in CineForge. Unexplained damage or loss may result in a replacement cost charge.',
  },
  {
    sectionId: 'rules', title: 'Attendance policy', order: 1,
    body: 'You are expected to attend all scheduled lessons. Absences above 20% of total lessons may affect your year progression.\n\nAlways report absences through the app **before** the lesson starts. Late absence reports may be counted as unexcused.',
  },
  {
    sectionId: 'rules', title: 'Equipment responsibility', order: 2,
    body: 'You are personally responsible for all equipment from the moment of checkout to the moment of return.\n\nEquipment must be returned:\n- On or before the agreed return date\n- Clean and fully functional\n- Complete with all accessories, cables, and cases\n\nFailure to return equipment on time blocks future bookings.',
  },
  {
    sectionId: 'rules', title: 'Editing room bookings', order: 3,
    body: 'Editing rooms A–G can be booked through **Booking → Room Booking**. Bookings are per time block (morning, afternoon, evening).\n\nDo not occupy a room you have not booked. Cancel bookings you no longer need so other students can use the space.',
  },
]

for (const section of sections) {
  await db.collection('guide_sections').doc(section.id).set({ ...section, createdAt: new Date() })
  console.log(`Created section: ${section.title}`)
}
for (const article of articles) {
  await db.collection('guide_articles').add({ ...article, isPublished: true, createdAt: new Date() })
  console.log(`Created article: ${article.title}`)
}

console.log(`\nSeeded ${sections.length} sections and ${articles.length} articles`)
process.exit(0)
