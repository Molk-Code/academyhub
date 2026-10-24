// Detects "stale chunk" errors — a dynamic import failing because the hashed
// asset it points at no longer exists after a newer deploy replaced it (the
// hosting rewrite then serves index.html, hence Safari's "'text/html' is not a
// valid JavaScript MIME type"). The fix is always a full reload, which fetches
// the fresh index.html and the new chunk names.
export function isStaleChunkError(msg: string): boolean {
  return msg.includes('Failed to fetch dynamically imported module')
    || msg.includes('Importing a module script failed')
    || msg.includes('error loading dynamically imported module')
    || msg.includes('is not a valid JavaScript MIME type')
    || msg.includes('Unable to preload CSS')
}

const RELOAD_AT_KEY = 'staleChunkReloadAt'
// A reload that happened this recently and still hit a stale chunk means the
// failure isn't staleness (offline, broken deploy) — don't loop.
const MIN_RELOAD_INTERVAL_MS = 30_000

let reloading = false

// Returns true if this is a stale-chunk error and a reload is underway (the
// caller should show an "updating" state, not an error); false otherwise.
export function reloadForStaleChunk(msg: string): boolean {
  if (!isStaleChunkError(msg)) return false
  // Already reloading: React may re-throw the same lazy error before the
  // navigation completes — keep answering true so no error screen flashes.
  if (reloading) return true
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? 0) } catch { /* ignore */ }
  if (Date.now() - last < MIN_RELOAD_INTERVAL_MS) return false
  try { sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now())) } catch { /* ignore */ }
  reloading = true
  window.location.reload()
  return true
}
