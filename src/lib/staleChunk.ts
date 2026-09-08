// Detects "stale chunk" errors — a dynamic import failing because the
// hashed asset it points at no longer exists after a newer deploy replaced
// it. Keyed by the specific failing module URL (not a single flag) so that
// a *later* deploy, which invalidates a *different* chunk, still gets its
// own auto-reload instead of falling straight through to the error screen.
export function extractStaleChunkKey(msg: string): string | null {
  const isStaleChunk = msg.includes('Failed to fetch dynamically imported module')
    || msg.includes('Importing a module script failed')
    || msg.includes('is not a valid JavaScript MIME type')
    || msg.includes('text/html')
  if (!isStaleChunk) return null
  return msg.match(/https?:\/\/\S+\.m?js\b/)?.[0] ?? msg
}

const STORAGE_KEY = 'chunkReloadedFor'

// Returns true and reloads once per distinct failing chunk if this looks
// like a stale-chunk error; returns false (no reload) otherwise.
export function reloadOnceForStaleChunk(msg: string): boolean {
  const key = extractStaleChunkKey(msg)
  if (!key || sessionStorage.getItem(STORAGE_KEY) === key) return false
  sessionStorage.setItem(STORAGE_KEY, key)
  window.location.reload()
  return true
}
