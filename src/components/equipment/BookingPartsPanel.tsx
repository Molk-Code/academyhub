import { Link, useNavigate } from 'react-router-dom'
import { Check, X, Undo2, ArrowRight, ExternalLink, Clock, Clapperboard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { bookingParts, handlesCategory, myParts, partStatus, type PartStatus } from '@/lib/bookingParts'
import type { EquipmentBookingDoc, EquipmentResponsibility } from '@/types'

type Catalog = Map<string, { category?: string }>

const STATUS: Record<PartStatus, { label: string; cls: string }> = {
  pending:   { label: 'Awaiting review', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  confirmed: { label: 'Confirmed',       cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  denied:    { label: 'Denied',          cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
  'set-up':  { label: 'In project',      cls: 'text-orange-300 bg-orange-500/10 border-orange-500/30' },
}

export function PartStatusBadge({ booking, category }: { booking: EquipmentBookingDoc; category: string }) {
  const st = partStatus(booking, category)
  const by = booking.categoryDecisions?.[category]?.byName
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap', STATUS[st].cls)}>
      {st === 'pending' ? <Clock className="w-3 h-3" /> : st === 'denied' ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
      {STATUS[st].label}{by && (st === 'confirmed' || st === 'denied') ? ` · ${by}` : ''}
    </span>
  )
}

// Staff review of a booking, part by part: the categories this person handles
// are highlighted with their actions, everyone else's parts are greyed out.
export function BookingPartsPanel({
  booking, catalog, responsibility, inventoryPath, busy, onDecide,
}: {
  booking: EquipmentBookingDoc
  catalog: Catalog
  responsibility: EquipmentResponsibility | undefined
  inventoryPath: string
  busy?: boolean
  onDecide: (categories: string[], decision: 'confirmed' | 'denied' | 'pending') => void
}) {
  const navigate = useNavigate()
  const parts = bookingParts(booking, catalog)
  const mine = myParts(booking, responsibility, catalog)
  const pendingCats = mine.pending.map(p => p.category)
  const canChange = ['pending', 'confirmed', 'denied', 'checked-out'].includes(booking.status)
  const severalParts = parts.length > 1

  return (
    <div className="space-y-2">
      {parts.map(p => {
        const st = partStatus(booking, p.category)
        const isMine = handlesCategory(responsibility, p.category)
        const projectId = booking.setUpCategories?.[p.category] ?? (st === 'set-up' ? booking.linkedProjectId : undefined)
        return (
          <div
            key={p.category}
            className={cn(
              'rounded-xl border px-3 py-2.5 transition-opacity',
              isMine ? 'border-brand-500/40 bg-brand-500/[0.07]' : 'border-white/[0.06] bg-white/[0.02] opacity-50',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                {p.category}
                {!isMine && <span className="ml-2 normal-case tracking-normal font-medium text-zinc-500">· someone else handles this</span>}
              </span>
              <PartStatusBadge booking={booking} category={p.category} />
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {p.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-3 text-[13px] text-zinc-300">
                  <span className="min-w-0 break-words">{it.equipmentName}</span>
                  <span className="text-zinc-500 flex-shrink-0">×{it.quantity}</span>
                </li>
              ))}
            </ul>
            {isMine && canChange && (
              <div className="mt-2 flex flex-wrap gap-2">
                {st === 'pending' && (
                  <>
                    <button disabled={busy} onClick={() => onDecide([p.category], 'confirmed')} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> Accept{severalParts ? ` ${p.category.toLowerCase()}` : ''}
                    </button>
                    <button disabled={busy} onClick={() => onDecide([p.category], 'denied')} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-50">
                      <X className="w-3.5 h-3.5" /> Deny
                    </button>
                  </>
                )}
                {(st === 'confirmed' || st === 'denied') && (
                  <button disabled={busy} onClick={() => onDecide([p.category], 'pending')} title="Move this part back to awaiting review" className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 disabled:opacity-50">
                    <Undo2 className="w-3.5 h-3.5" /> Undo
                  </button>
                )}
              </div>
            )}
            {st === 'set-up' && projectId && (
              <button onClick={() => navigate(`${inventoryPath}?openProject=${projectId}`)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-300 hover:text-orange-200">
                View project <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
        )
      })}

      {(pendingCats.length > 1 || mine.toSetUp.length > 0) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {pendingCats.length > 1 && (
            <>
              <button disabled={busy} onClick={() => onDecide(pendingCats, 'confirmed')} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white disabled:opacity-50">
                <Check className="w-3.5 h-3.5" /> Accept all my parts ({pendingCats.length})
              </button>
              <button disabled={busy} onClick={() => onDecide(pendingCats, 'denied')} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> Deny all mine
              </button>
            </>
          )}
          {mine.toSetUp.length > 0 && (
            <button onClick={() => navigate(`${inventoryPath}?fromBooking=${booking.id}`)} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/25">
              Set up {severalParts ? mine.toSetUp.map(p => p.category).join(' + ') : ''} in Inventory <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Student view: how each part of the booking stands (only when it has parts)
export function BookingPartsSummary({ booking }: { booking: EquipmentBookingDoc }) {
  const parts = bookingParts(booking)
  if (parts.length < 2) return null
  return (
    <div className="space-y-1.5">
      {parts.map(p => (
        <div key={p.category} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{p.category}</span>
            <PartStatusBadge booking={booking} category={p.category} />
          </div>
          <p className="mt-1 text-xs text-zinc-300">{p.items.map(it => `${it.quantity}× ${it.equipmentName}`).join(' · ')}</p>
        </div>
      ))}
    </div>
  )
}

// Bookings sent from a production link back to its planning page.
// Staff open it under /teacher, students under their own routes.
export function ProductionLink({ booking, staff }: { booking: EquipmentBookingDoc; staff: boolean }) {
  if (!booking.productionId && !booking.productionTitle) return null
  const label = booking.productionTitle || 'Production'
  if (!booking.productionId) {
    return <p className="inline-flex items-center gap-1.5 text-xs text-zinc-400"><Clapperboard className="w-3.5 h-3.5" /> {label}</p>
  }
  return (
    <Link
      to={`${staff ? '/teacher' : ''}/production/planning/${booking.productionId}`}
      onClick={e => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 max-w-full text-xs font-semibold text-orange-300 hover:text-orange-200 bg-orange-500/10 border border-orange-500/25 rounded-lg px-2.5 py-1.5"
    >
      <Clapperboard className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
      <span className="flex-shrink-0 font-medium text-orange-300/80">Open production →</span>
    </Link>
  )
}
