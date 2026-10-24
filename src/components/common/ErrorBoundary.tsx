import { Component, type ReactNode, type ErrorInfo } from 'react'
import { reloadForStaleChunk } from '@/lib/staleChunk'
import { reportClientError as reportError } from '@/lib/clientErrorReport'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null; updating?: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    // Stale chunk after a new deploy — reload into the new version. Keep
    // rendering the "updating" screen (not the children, which would just
    // re-throw the same lazy error) until the navigation takes over.
    const msg = error.name === 'ChunkLoadError' ? 'Failed to fetch dynamically imported module' : (error.message ?? '')
    if (reloadForStaleChunk(msg)) {
      return { hasError: false, error: null, updating: true }
    }
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.state.updating) return
    console.error('ErrorBoundary caught:', error, info)
    reportError(error.message, error.stack, `ErrorBoundary: ${info.componentStack?.split('\n')[1]?.trim() ?? ''}`)
  }

  render() {
    if (this.state.updating) {
      return (
        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4 text-white p-8">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-zinc-400">Updating to the latest version…</p>
        </div>
      )
    }
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
