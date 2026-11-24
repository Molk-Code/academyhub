import { Link } from 'react-router-dom'
import { Package, ClipboardList, MessageSquare } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import { useFeature } from '@/hooks/useFeature'
import { useModuleGate } from '@/hooks/useModules'
import { useProjectItems } from '@/components/equipment/ContractSignPanel'
import { unitsSummary } from '@/pages/equipment/InventoryCounter'
import { STATUS_TONE } from '@/lib/statusTone'
import ContractsToSign from './ContractsToSign'
import type { InventoryProjectDoc } from '@/types'

function fmt(d: string) {
  const dt = new Date(d + 'T12:00:00')
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// Home for someone who borrows gear but isn't in a class: a rental house's
// borrower, or a student not yet placed in one. No points, streaks or
// leaderboard here; just contracts, the gear they hold and what to do next.
export default function BorrowerHome({ firstName, notInClass }: { firstName: string; notInClass?: boolean }) {
  const { profile } = useAuth()
  const uid = profile?.uid ?? ''
  const canEquipment = useFeature('equipment')
  const canChat = useFeature('chat')
  const rental = useModuleGate('rental_inventory')
  const gear = canEquipment && rental
  const { data: projects } = useCollection<InventoryProjectDoc>(
    'inventory_projects',
    gear && uid ? [where('borrowerIds', 'array-contains', uid)] : [],
    gear && !!uid,
    `borrower-${uid}`,
  )
  const holding = projects.filter(p => p.status === 'checked-out').sort((a, b) => a.returnDate.localeCompare(b.returnDate))
  const items = useProjectItems(holding.map(p => p.id))
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6 max-w-xl">
      <div className="space-y-1">
        <h1 className="page-title">Hi {firstName}</h1>
        {notInClass && (
          <p className="text-sm text-zinc-400">You're not in a class yet. Your teacher adds you, and your lessons show up here after that.</p>
        )}
      </div>

      <ContractsToSign />

      {holding.length > 0 && (
        <section aria-labelledby="gear-you-have" className="space-y-2">
          <h2 id="gear-you-have" className="text-base font-bold text-zinc-100">Gear you have</h2>
          <ul className="space-y-2">
            {holding.map(p => {
              const late = p.returnDate < today
              const out = items.filter(i => i.projectId === p.id && i.status !== 'returned')
              return (
                <li key={p.id}>
                  <Link to={`/my-bookings?focus=${p.id}`} className="flex items-center justify-between gap-3 min-h-[56px] px-4 py-3 rounded-2xl bg-[var(--bg-surface)] border border-white/[0.07] hover:border-white/15">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-zinc-100">{out.length > 0 ? unitsSummary(out) : p.name}</span>
                      <span className="block text-sm text-zinc-400">{p.name}</span>
                    </span>
                    <span className="text-sm font-semibold whitespace-nowrap" style={{ color: late ? STATUS_TONE.overdue.fg : STATUS_TONE.out.fg }}>
                      {late ? 'Overdue' : p.returnDate === today ? 'Back today' : `Back ${fmt(p.returnDate)}`}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <nav aria-label="Next steps" className="grid gap-2 sm:grid-cols-2">
        {gear && (
          <Link to="/booking/equipment" className="btn-primary min-h-[48px] justify-center">
            <Package className="w-4 h-4" aria-hidden="true" /> Book equipment
          </Link>
        )}
        <Link to="/my-bookings" className="btn-secondary min-h-[48px] justify-center">
          <ClipboardList className="w-4 h-4" aria-hidden="true" /> My bookings
        </Link>
        {canChat && (
          <Link to="/chat" className="btn-secondary min-h-[48px] justify-center">
            <MessageSquare className="w-4 h-4" aria-hidden="true" /> Message staff
          </Link>
        )}
      </nav>
    </div>
  )
}
