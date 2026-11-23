import { Link } from 'react-router-dom'
import { PenLine } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import { useFeature } from '@/hooks/useFeature'
import { useModuleGate } from '@/hooks/useModules'
import type { InventoryProjectDoc } from '@/types'

function fmt(d: string) {
  const dt = new Date(d + 'T12:00:00')
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Top of a borrower's home: equipment contracts staff have asked them to sign
// (inventory_projects.pendingSignatureUids, kept by the signing functions).
// Signing itself happens in My Bookings.
export default function ContractsToSign({ bookingsPath = '/my-bookings' }: { bookingsPath?: string }) {
  const { profile } = useAuth()
  const uid = profile?.uid ?? ''
  const inventory = useFeature('inventory')
  const rental = useModuleGate('rental_inventory')
  const enabled = inventory && rental && !!uid
  const { data: projects } = useCollection<InventoryProjectDoc>(
    'inventory_projects',
    enabled ? [where('pendingSignatureUids', 'array-contains', uid)] : [],
    enabled,
    uid,
  )
  const open = projects.filter(p => ['active', 'checked-out'].includes(p.status))
  if (open.length === 0) return null

  return (
    <section aria-labelledby="contracts-to-sign" className="rounded-2xl border border-brand-500/35 bg-brand-500/10 p-4 space-y-3">
      <h2 id="contracts-to-sign" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand-300">
        <PenLine className="w-4 h-4" aria-hidden="true" />
        {open.length === 1 ? 'Contract to sign' : `${open.length} contracts to sign`}
      </h2>
      <ul className="space-y-3">
        {open.map(p => (
          <li key={p.id} className="space-y-2">
            <div>
              <p className="font-semibold text-zinc-50">{p.name}</p>
              <p className="text-sm text-zinc-300">Equipment {fmt(p.checkoutDate)} – {fmt(p.returnDate)}</p>
            </div>
            <Link to={`${bookingsPath}?focus=${p.id}`} className="btn-primary w-full sm:w-auto min-h-[48px]">
              Review and sign
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
