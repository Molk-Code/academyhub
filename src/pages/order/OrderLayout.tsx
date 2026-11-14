import { NavLink, Outlet } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { isSuperAdminEmail } from '@/lib/superadmin'
import { useNoIndex } from '@/lib/pageMeta'
import { LEGAL } from '@/config/legal'
import { TERMS_VERSION, openDecisions } from '@/config/orderTerms'
import NotFound from '@/pages/NotFound'

// The order page and its terms (/order, /order/terms, /order/dpa). Hidden for
// now: only the superadmin sees them — everyone else gets the 404 page — and
// they're never indexed. Built without the app's chrome so they can move to
// their own domain later; they only need Firebase and the order functions.

export default function OrderLayout() {
  const { user, profile, loading } = useAuth()
  useNoIndex()

  if (loading || (user && !profile)) return <div className="min-h-screen bg-zinc-950" aria-busy="true" />
  if (!isSuperAdminEmail(profile?.email)) return <NotFound />

  const open = openDecisions().length
  const tab = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-sm ${isActive ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200'}`

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div role="note" className="bg-amber-500/15 border-b border-amber-500/30 text-amber-100 text-xs px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span className="flex items-center gap-1.5 font-semibold"><Eye className="w-3.5 h-3.5" aria-hidden="true" /> Preview: only you can see this</span>
        <span>Terms version {TERMS_VERSION} (draft, needs legal review)</span>
        {open > 0 && <span>{open} decision{open === 1 ? '' : 's'} open in src/config/orderTerms.ts</span>}
        <span>Orders sent from here are marked as previews</span>
      </div>
      <header className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 flex flex-wrap items-center justify-between gap-3">
        <NavLink to="/order" end className="text-lg font-bold text-white">{LEGAL.appName}</NavLink>
        <nav className="flex gap-1" aria-label="Ordering">
          <NavLink to="/order" end className={tab}>Order</NavLink>
          <NavLink to="/order/terms" className={tab}>Terms of Service</NavLink>
          <NavLink to="/order/dpa" className={tab}>Data processing agreement</NavLink>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Outlet />
      </main>
    </div>
  )
}

/** A value not decided yet, marked so it can't be mistaken for real wording */
export function Missing({ what }: { what: string }) {
  return (
    <mark className="bg-amber-500/20 text-amber-200 rounded px-1.5 py-0.5 text-[0.85em] not-italic font-medium">
      Missing: {what}
    </mark>
  )
}

/** The decided value, or a Missing marker */
export function Decided({ value, what }: { value: string; what: string }) {
  return value.trim() ? <>{value}</> : <Missing what={what} />
}
