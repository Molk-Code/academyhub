import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '@/lib/firebase'

// A broken browser environment (e.g. IndexedDB unavailable) can make the
// exact same error fire on every Firestore listener/retry — hundreds of
// times in a single tab session. Cap how many times we'll write a report
// for the same message in one session so one bad client can't flood
// `_client_errors` or hammer Firestore with writes while it's already
// struggling.
const MAX_REPORTS_PER_MESSAGE = 5
const COUNTS_KEY = 'clientErrorCounts'

function shouldReport(message: string): boolean {
  let counts: Record<string, number> = {}
  try { counts = JSON.parse(sessionStorage.getItem(COUNTS_KEY) ?? '{}') } catch { /* ignore */ }
  const n = (counts[message] ?? 0) + 1
  if (n > MAX_REPORTS_PER_MESSAGE) return false
  counts[message] = n
  try { sessionStorage.setItem(COUNTS_KEY, JSON.stringify(counts)) } catch { /* ignore */ }
  return true
}

export async function reportClientError(message: string, stack: string | undefined, context: string) {
  if (!shouldReport(message)) return
  try {
    await addDoc(collection(db, '_client_errors'), {
      // Trimmed to the rules' size caps
      message: String(message).slice(0, 2000),
      stack:   stack ? stack.slice(0, 10000) : null,
      context: String(context).slice(0, 2000),
      uid:     auth.currentUser?.uid ?? null,
      url:     window.location.href.slice(0, 2000),
      ua:      navigator.userAgent.slice(0, 500),
      ts:    serverTimestamp(),
    })
  } catch {
    // Never let error reporting crash the app
  }
}
