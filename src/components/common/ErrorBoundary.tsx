import { Component, type ReactNode, type ErrorInfo } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '@/lib/firebase'

async function reportError(message: string, stack: string | undefined, context: string) {
  try {
    await addDoc(collection(db, '_client_errors'), {
      message,
      stack: stack ?? null,
      context,
      uid:   auth.currentUser?.uid ?? null,
      url:   window.location.href,
      ua:    navigator.userAgent,
      ts:    serverTimestamp(),
    })
  } catch {
    // Never let error reporting crash the app
  }
}

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    // Stale chunk after a new deploy — auto-reload once instead of showing error
    const isChunkError = error.message?.includes('Failed to fetch dynamically imported module')
      || error.message?.includes('Importing a module script failed')
      || error.message?.includes('is not a valid JavaScript MIME type')
      || error.message?.includes('text/html')
      || error.name === 'ChunkLoadError'
    if (isChunkError && !sessionStorage.getItem('chunkReloaded')) {
      sessionStorage.setItem('chunkReloaded', '1')
      window.location.reload()
      return { hasError: false, error: null }
    }
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
    reportError(error.message, error.stack, `ErrorBoundary: ${info.componentStack?.split('\n')[1]?.trim() ?? ''}`)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white p-8">
          <div className="text-center max-w-md">
            <p className="text-6xl mb-6">😵</p>
            <h1 className="text-2xl font-bold mb-3">Something went wrong</h1>
            <p className="text-gray-400 mb-2 text-sm">
              An unexpected error occurred. Try refreshing the page.
            </p>
            <p className="text-gray-600 text-xs mb-8 font-mono bg-white/5 rounded-xl px-4 py-3">
              {this.state.error?.message ?? 'Unknown error'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm"
              >
                Refresh page
              </button>
              <button
                onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/' }}
                className="bg-white/10 hover:bg-white/15 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
