declare const __BUILD_ID__: string

// Detects "stale chunk" errors — a dynamic import failing because the
// hashed asset it points at no longer exists after a newer deploy replaced
// it. Keyed by the specific failing module URL (not a single flag) so that
// a *later* deploy, which invalidates a *different* chunk, still gets its
// own auto-reload instead of falling straight through to the error screen.
//
// Some browsers (notably Safari) report this without the failing URL in the
// message at all — e.g. "'text/html' is not a valid JavaScript MIME type."
// — in which case the key falls back to the raw message text, which is
// IDENTICAL across unrelated chunks/deploys. Without __BUILD_ID__ in the
// key, the first such error in a tab's session "uses up" that shared key
// forever, so any *later*, unrelated stale-chunk error in the same tab
// (e.g. after a second deploy goes out while the tab is still open) skips
// the auto-reload and falls through to the error screen instead.
// __BUILD_ID__ changes every deploy, so folding it into the key still lets
// a later deploy's failure reload normally.
export function extractStaleChunkKey(msg: string): string | null {
  const isStaleChunk = msg.includes('Failed to fetch dynamically imported module')
    || msg.includes('Importing a module script failed')
    || msg.includes('is not a valid JavaScript MIME type')
    || msg.includes('text/html')
  if (!isStaleChunk) return null
  const base = msg.match(/https?:\/\/\S+\.m?js\b/)?.[0] ?? msg
  return `${base}::${__BUILD_ID__}`
}

const STORAGE_KEY = 'chunkReloadedFor'
const MAX_TRACKED_KEYS = 20

// Returns true and reloads once per distinct failing chunk if this looks
// like a stale-chunk error; returns false (no reload) otherwise.
export function reloadOnceForStaleChunk(msg: string): boolean {
  const key = extractStaleChunkKey(msg)
  if (!key) return false
  const seen = sessionStorage.getItem(STORAGE_KEY)?.split(',') ?? []
  if (seen.includes(key)) return false
  sessionStorage.setItem(STORAGE_KEY, [...seen, key].slice(-MAX_TRACKED_KEYS).join(','))
  window.location.reload()
  return true
}
