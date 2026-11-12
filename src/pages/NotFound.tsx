import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { LEGAL } from '@/config/legal'
import { usePageMeta, useNoIndex } from '@/lib/pageMeta'

// Any address the app doesn't know. Hosting serves the app for every path, so
// the status is 200; the page says plainly that nothing is here.
export default function NotFound() {
  usePageMeta(`${LEGAL.appName} · Page not found`, 'This page does not exist.')
  useNoIndex()
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-zinc-900 rounded-3xl shadow-2xl p-8 text-center space-y-4">
        <Compass className="w-10 h-10 text-brand-400 mx-auto" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-zinc-100">Page not found</h1>
        <p className="text-sm text-zinc-400">There’s nothing at this address. It may have moved, or the link may be mistyped.</p>
        <Link to="/login" className="btn-primary inline-flex justify-center w-full py-3">Go to sign in</Link>
        <p className="text-xs text-zinc-500">Already signed in? The sign-in page takes you straight to your start page.</p>
      </div>
    </main>
  )
}
