import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import ErrorBoundary from './components/common/ErrorBoundary'
import './index.css'
import '@vidstack/react/player/styles/base.css'

import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '@/lib/firebase'

async function reportClientError(message: string, stack: string | undefined, context: string) {
  try {
    await addDoc(collection(db, '_client_errors'), {
      message, stack: stack ?? null, context,
      uid: auth.currentUser?.uid ?? null,
      url: window.location.href,
      ua:  navigator.userAgent,
      ts:  serverTimestamp(),
    })
  } catch { /* never crash on reporting */ }
}

// Auto-reload once on stale chunk / MIME errors; report everything else
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message ?? String(event.reason ?? '')
  const isStaleChunk = msg.includes('Failed to fetch dynamically imported module')
    || msg.includes('Importing a module script failed')
    || msg.includes('is not a valid JavaScript MIME type')
    || msg.includes('text/html')
  if (isStaleChunk && !sessionStorage.getItem('chunkReloaded')) {
    sessionStorage.setItem('chunkReloaded', '1')
    window.location.reload()
    return
  }
  if (msg) reportClientError(msg, event.reason?.stack, 'unhandledrejection')
})

// On startup, check if the server has a newer build than what's cached.
// If so, reload once to pick up fresh assets (fixes iOS PWA stale cache).
declare const __BUILD_ID__: string
;(async () => {
  if (sessionStorage.getItem('buildChecked')) return
  sessionStorage.setItem('buildChecked', '1')
  try {
    const r = await fetch('/build-id.txt?_=' + Date.now(), { cache: 'no-store' })
    if (!r.ok) return
    const serverId = (await r.text()).trim()
    if (serverId && serverId !== __BUILD_ID__) {
      window.location.reload()
    }
  } catch { /* offline — ignore */ }
})()

window.addEventListener('error', (event) => {
  if (event.error) reportClientError(event.error.message, event.error.stack, 'window.onerror')
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,   // 2 min
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!, {
  onRecoverableError: (error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error)
    const el = document.getElementById('boot-msg')
    if (el) el.innerHTML = '<span style="color:#fca5a5;font-size:13px;padding:20px;text-align:center;display:block">Original error: ' + msg + '</span>'
  },
}).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
