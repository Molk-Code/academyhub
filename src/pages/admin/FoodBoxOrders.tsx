import { useState } from 'react'
import { doc, updateDoc, deleteDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { UtensilsCrossed, CheckCircle2, XCircle, Clock, Download, Loader2, ChevronDown, ChevronUp, Trash2, Pencil, Check, X } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import { useCollection, useDocument, orderBy } from '@/hooks/useFirestore'
import type { FoodBoxOrderDoc, BookingSettingsDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

type FilterStatus = 'all' | FoodBoxOrderDoc['status']

const STATUS_COLORS: Record<FoodBoxOrderDoc['status'], string> = {
  pending:   'bg-amber-950/40 text-amber-300 border-amber-800/50',
  confirmed: 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
  cancelled: 'bg-zinc-800 text-zinc-500 border-white/10',
}

function mealSummary(order: FoodBoxOrderDoc) {
  const parts = [
    order.morningStudents?.length ? `☕ ${order.morningStudents.length}` : '',
    order.lunchStudents?.length   ? `🥗 ${order.lunchStudents.length}`   : '',
    order.dinnerStudents?.length  ? `🍽️ ${order.dinnerStudents.length}`  : '',
  ].filter(Boolean)
  return parts.join('  ') || '–'
}

function StudentList({ names }: { names: string[] }) {
  if (!names?.length) return <span className="text-zinc-400 text-xs">–</span>
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {names.map(n => (
        <span key={n} className="text-xs bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full">{n}</span>
      ))}
    </div>
  )
}

function OrderRow({ order }: { order: FoodBoxOrderDoc }) {
  const [open,         setOpen]         = useState(false)
  const [updating,     setUpdating]     = useState(false)
  const [exporting,    setExporting]    = useState(false)
  const [deleting,     setDeleting]     = useState(false)
  const [editingTime,  setEditingTime]  = useState(false)
  const [timeInput,    setTimeInput]    = useState('')
  const [savingTime,   setSavingTime]   = useState(false)
  const [editingDate,  setEditingDate]  = useState(false)
  const [dateInput,    setDateInput]    = useState('')
  const [savingDate,   setSavingDate]   = useState(false)

  const effectivePickupTime = order.adminPickupTime ?? order.pickupTime
  const effectiveDate       = order.adminDate       ?? order.date

  async function savePickupTime() {
    setSavingTime(true)
    try {
      await updateDoc(doc(db, 'food_box_orders', order.id), {
        adminPickupTime: timeInput || null,
        pickupTimeModified: true,
        updatedAt: serverTimestamp(),
      })
      setEditingTime(false)
    } finally { setSavingTime(false) }
  }

  async function saveDate() {
    setSavingDate(true)
    try {
      await updateDoc(doc(db, 'food_box_orders', order.id), {
        adminDate: dateInput || null,
        pickupTimeModified: true,
        updatedAt: serverTimestamp(),
      })
      setEditingDate(false)
    } finally { setSavingDate(false) }
  }

  async function setStatus(status: FoodBoxOrderDoc['status']) {
    setUpdating(true)
    try { await updateDoc(doc(db, 'food_box_orders', order.id), { status, updatedAt: serverTimestamp() }) }
    finally { setUpdating(false) }
  }

  async function exportPdf() {
    setExporting(true)
    try {
      const fn = httpsCallable<{ orderId: string }, { pdf: string }>(functions, 'exportFoodBoxPdf')
      const result = await fn({ orderId: order.id })
      const bytes = Uint8Array.from(atob(result.data.pdf), c => c.charCodeAt(0))
      const blob  = new Blob([bytes], { type: 'application/pdf' })
      const url   = URL.createObjectURL(blob)
      const a     = document.createElement('a')
      a.href      = url
      a.download  = `matlada-${order.date}-${order.contactPerson.replace(/\s+/g, '-')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(false) }
  }

  async function handleDelete() {
    if (!confirm(`Delete order from ${order.contactPerson} on ${order.date}?`)) return
    setDeleting(true)
    try { await deleteDoc(doc(db, 'food_box_orders', order.id)) }
    finally { setDeleting(false) }
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-white/10 overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-zinc-100 truncate">{order.contactPerson}</span>
            <span className="text-xs text-zinc-400">
              {effectiveDate}{effectivePickupTime ? ` · ${effectivePickupTime}` : ''}
              {order.pickupTimeModified && <span className="ml-1 text-amber-500">●</span>}
            </span>
            <span className="text-xs text-zinc-500">{mealSummary(order)}</span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{order.studentName}</p>
        </div>
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0', STATUS_COLORS[order.status])}>
          {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-zinc-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-white/8 px-4 py-4 space-y-4">
          <div className="text-sm text-zinc-400 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-zinc-400">Date:</span>
              {editingDate ? (
                <span className="flex items-center gap-1">
                  <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)} className="border border-white/15 rounded px-2 py-0.5 text-sm" />
                  <button onClick={saveDate} disabled={savingDate} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200 disabled:opacity-50">
                    {savingDate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                  <button onClick={() => setEditingDate(false)} className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-500 text-xs font-medium">Cancel</button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span>{effectiveDate}</span>
                  {order.adminDate && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Admin updated</span>}
                  <button onClick={() => { setDateInput(effectiveDate); setEditingDate(true) }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 text-xs font-medium hover:bg-brand-100 hover:text-brand-700 transition-colors">
                    <Pencil className="w-3 h-3" /> Edit date
                  </button>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">Pick-up time:</span>
              {editingTime ? (
                <span className="flex items-center gap-1">
                  <input
                    type="time"
                    value={timeInput}
                    onChange={e => setTimeInput(e.target.value)}
                    className="border border-white/15 rounded px-2 py-0.5 text-sm"
                  />
                  <button
                    onClick={savePickupTime}
                    disabled={savingTime}
                    className="p-1 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {savingTime ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => setEditingTime(false)} className="p-1 rounded text-zinc-400 hover:bg-zinc-800">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-2 flex-wrap">
                  <span>{effectivePickupTime ?? '–'}</span>
                  {order.pickupTimeModified && (
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Admin updated</span>
                  )}
                  <button
                    onClick={() => { setTimeInput(effectivePickupTime ?? ''); setEditingTime(true) }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 text-xs font-medium hover:bg-brand-100 hover:text-brand-700 transition-colors"
                  >
                    <Pencil className="w-3 h-3" /> Edit time
                  </button>
                </span>
              )}
            </div>
            <p><span className="text-zinc-400">Phone:</span> {order.phoneNumber}</p>
          </div>

          <div className="space-y-3 text-sm">
            {order.morningStudents?.length > 0 && (
              <div>
                <p className="font-medium text-zinc-300">☕ Morning ({order.morningStudents.length})</p>
                <StudentList names={order.morningStudents} />
                {order.morningDiet && <p className="text-zinc-500 mt-1 text-xs">Diet: {order.morningDiet}</p>}
              </div>
            )}
            {order.lunchStudents?.length > 0 && (
              <div>
                <p className="font-medium text-zinc-300">🥗 Lunchbox ({order.lunchStudents.length})</p>
                <StudentList names={order.lunchStudents} />
                <p className="text-zinc-500 mt-0.5 text-xs">Heat: {order.lunchCanHeat === null ? '–' : order.lunchCanHeat ? 'Yes' : 'No'}</p>
                {order.lunchDiet && <p className="text-zinc-500 text-xs">Diet: {order.lunchDiet}</p>}
              </div>
            )}
            {order.dinnerStudents?.length > 0 && (
              <div>
                <p className="font-medium text-zinc-300">🍽️ Dinnerbox ({order.dinnerStudents.length})</p>
                <StudentList names={order.dinnerStudents} />
                <p className="text-zinc-500 mt-0.5 text-xs">Heat: {order.dinnerCanHeat === null ? '–' : order.dinnerCanHeat ? 'Yes' : 'No'}</p>
                {order.dinnerDiet && <p className="text-zinc-500 text-xs">Diet: {order.dinnerDiet}</p>}
              </div>
            )}
          </div>

          {order.otherNotes && (
            <p className="text-sm text-zinc-400 bg-zinc-900/50 rounded-lg px-3 py-2">📝 {order.otherNotes}</p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {order.status === 'pending' && (
              <>
                <button
                  onClick={() => setStatus('confirmed')}
                  disabled={updating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/40 text-emerald-300 text-sm font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
                </button>
                <button
                  onClick={() => setStatus('cancelled')}
                  disabled={updating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 text-rose-300 text-sm font-medium hover:bg-rose-100 transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel
                </button>
              </>
            )}
            {order.status !== 'pending' && (
              <button
                onClick={() => setStatus('pending')}
                disabled={updating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                <Clock className="w-3.5 h-3.5" /> Reset
              </button>
            )}
            {order.status === 'confirmed' && (
              <button
                onClick={exportPdf}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-sm font-medium hover:bg-brand-100 transition-colors disabled:opacity-50"
              >
                {exporting
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Exporting…</>
                  : <><Download className="w-3.5 h-3.5" /> Export PDF</>
                }
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 text-sm font-medium hover:bg-rose-100 transition-colors disabled:opacity-50 ml-auto"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const FILTERS: { id: FilterStatus; label: string }[] = [
  { id: 'all',       label: 'All'       },
  { id: 'pending',   label: 'Pending'   },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'cancelled', label: 'Cancelled' },
]

function LeadDaysSetting() {
  const { data: settings } = useDocument<BookingSettingsDoc>('settings', 'booking')
  const current = settings?.foodBoxLeadDays ?? 5
  const [editing, setEditing] = useState(false)
  const [input,   setInput]   = useState('')
  const [saving,  setSaving]  = useState(false)

  async function save() {
    const val = Math.max(1, parseInt(input, 10) || 5)
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'booking'), { foodBoxLeadDays: val }, { merge: true })
      setEditing(false)
    } finally { setSaving(false) }
  }

  return (
    <section className="bg-zinc-900 rounded-2xl border border-white/10 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-200">Minimum advance notice</p>
          <p className="text-xs text-zinc-400 mt-0.5">How many working days in advance students must place food box orders.</p>
        </div>
        {editing ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              autoFocus
              type="number"
              min={1}
              max={30}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
              className="input w-20 text-sm py-1.5 text-center"
            />
            <span className="text-sm text-zinc-500 whitespace-nowrap">working days</span>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-40 transition-colors">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
            </button>
            <button onClick={() => setEditing(false)}
              className="px-2 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 text-xs font-medium hover:bg-zinc-700 transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-sm font-bold text-brand-700 bg-brand-50 px-3 py-1 rounded-full">{current} days</span>
            <button onClick={() => { setInput(String(current)); setEditing(true) }}
              className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export default function FoodBoxOrders() {
  const { data: orders, loading } = useCollection<FoodBoxOrderDoc>('food_box_orders', [
    orderBy('createdAt', 'desc'),
  ])
  const [filter, setFilter] = useState<FilterStatus>('all')

  const visible = filter === 'all' ? orders : orders.filter(o => o.status === filter)

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <UtensilsCrossed className="w-6 h-6 text-brand-500" />
        <div>
          <h1 className="page-title">Food Box Orders</h1>
          <p className="text-zinc-500 text-sm">Incoming orders from students for on-location shoots.</p>
        </div>
      </div>

      <LeadDaysSetting />

      {/* Filter tabs */}
      <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 w-fit flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              filter === f.id ? 'bg-zinc-900 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {f.label}
            {f.id !== 'all' && (
              <span className="ml-1.5 text-xs text-zinc-400">
                {orders.filter(o => o.status === f.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">No orders.</div>
      ) : (
        <div className="space-y-2">
          {visible.map(order => <OrderRow key={order.id} order={order} />)}
        </div>
      )}
    </div>
  )
}
