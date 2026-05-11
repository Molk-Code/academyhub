import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 flex items-center justify-center p-8" style={{ background: 'var(--bg-primary)' }}>
          <div className="max-w-lg w-full">
            <h1 className="text-lg font-bold text-rose-400 mb-2">Render error</h1>
            <pre className="text-xs bg-zinc-800 rounded-xl p-4 overflow-auto text-zinc-300 whitespace-pre-wrap">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
