import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import ErrorBoundary from './components/common/ErrorBoundary'
import './index.css'
import '@vidstack/react/player/styles/base.css'

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
