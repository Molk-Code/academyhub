import { useState } from 'react'
import { PenLine } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import { useFeature } from '@/hooks/useFeature'
import { useModuleGate } from '@/hooks/useModules'
import ContractSignPanel, { useProjectItems } from '@/components/equipment/ContractSignPanel'
import { unitsSummary } from '@/pages/equipment/InventoryCounter'
import type { InventoryProjectDoc } from '@/types'

function fmt(d: string) {
  const dt = new Date(d + 'T12:00:00')
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Open equipment projects staff have asked this user to sign (pendingSignatureUids, kept by the signing functions) */
export function useContractsToSign() {
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
  return projects.filter(p => ['active', 'checked-out'].includes(p.status))
}

// Top of a borrower's home: the contract, what it covers, and signing right here
export default function ContractsToSign() {
  const { profile } = useAuth()
  const uid = profile?.uid ?? ''
  const open = useContractsToSign()
  const items = useProjectItems(open.map(p => p.id))
  const [signingId, setSigningId] = useState<string | null>(null)
  if (open.length === 0) return null

  return (
    <section aria-labelledby="contracts-to-sign" className="rounded-2xl border border-brand-500/40 bg-brand-500/10 p-4 space-y-4">
      <h2 id="contracts-to-sign" className="flex items-center gap-2 text-base font-bold text-zinc-50">
        <PenLine className="w-4 h-4 text-brand-300" aria-hidden="true" />
        {open.length === 1 ? 'Sign before pickup' : `${open.length} contracts to sign`}
      </h2>
      <ul className="space-y-4">
        {open.map(p => {
          const pItems = items.filter(i => i.projectId === p.id)
          return (
            <li key={p.id} className="space-y-3">
              <div>
                <p className="font-semibold text-zinc-50">{p.name}</p>
                <p className="text-sm text-zinc-300">
                  Pickup {fmt(p.checkoutDate)} · Back {fmt(p.returnDate)}{pItems.length > 0 && ` · ${pItems.length} ${pItems.length === 1 ? 'item' : 'items'}`}
                </p>
              </div>
              {pItems.length > 0 && <p className="text-sm text-zinc-200 leading-relaxed">{unitsSummary(pItems)}</p>}
              {signingId === p.id
                ? <ContractSignPanel project={p} items={pItems} uid={uid} startOpen />
                : (
                  <button type="button" onClick={() => setSigningId(p.id)} className="btn-primary w-full sm:w-auto min-h-[48px]">
                    Read and sign the contract
                  </button>
                )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
