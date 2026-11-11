import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { getPerformance } from 'firebase/performance'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

// App Check: proves requests come from this app, not a script holding the
// public API key. Off until a reCAPTCHA v3 site key is set in
// VITE_RECAPTCHA_V3_SITE_KEY (and the app is registered under App Check in the
// Firebase console); enforcement is then switched on per product there.
const appCheckKey = import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY as string | undefined
if (appCheckKey) {
  try {
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheckKey), isTokenAutoRefreshEnabled: true })
  } catch (err) {
    console.warn('App Check not started', err)
  }
}

export const auth      = getAuth(app)
export const db        = getFirestore(app)
export const storage   = getStorage(app)
// Production (no VITE_FUNCTIONS_REGION) stays on us-central1; .env.eu sets europe-west1
export const FUNCTIONS_REGION: string = import.meta.env.VITE_FUNCTIONS_REGION || 'us-central1'
export const functions = getFunctions(app, FUNCTIONS_REGION)
export const perf      = getPerformance(app)

// Local testing only (`vite --mode emulator`, see .env.emulator): talk to the
// Firebase emulators instead of a real project. Never set in real builds.
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}

// Persist auth across browser sessions (survives tab/window close)
setPersistence(auth, browserLocalPersistence).catch(() => {})
