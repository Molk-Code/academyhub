// Diagnostic (read-only): confirm equipment ids are 20-char alphanumeric (barcode unit parsing relies on it).
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
initializeApp({ credential: cert(require('./serviceAccountKey.json')) })
const snap = await getFirestore().collection('equipment').get()
const odd = snap.docs.filter(d => !/^[A-Za-z0-9]{20}$/.test(d.id))
console.log('total', snap.size, 'non-standard ids', odd.length, odd.slice(0, 10).map(d => d.id))
