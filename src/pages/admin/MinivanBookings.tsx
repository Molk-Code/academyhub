import { useState } from 'react'
import { doc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { Car, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, Trash2, Loader2, Pencil, Check, X, Download, Plus } from 'lucide-react'
import { functions } from '@/lib/firebase'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { MinivanBookingDoc, VehicleDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

type FilterStatus = 'all' | MinivanBookingDoc['status']

const STATUS_COLORS: Record<MinivanBookingDoc['status'], string> = {
  pending:  'bg-amber-950/40 text-amber-300 border-amber-800/50',
  approved: 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50',
  rejected: 'bg-rose-950/40 text-rose-300 border-rose-800/50',
}

function TimeEditor({
  label, value, type = 'time', onSave,
}: { label: string; value: string; type?: 'time' | 'date'; onSave: (t: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [input,   setInput]   = useState('')
  const [saving,  setSaving]  = useState(false)

  async function handleSave() {
    setSaving(true)
    try { await onSave(input); setEditing(false) }
    finally { setSaving(false) }
  }

  return editing ? (
    <span className="flex items-center gap-1 flex-wrap">
      <input
        type={type}
        value={input}
        onChange={e => setInput(e.target.value)}
        className="border border-white/15 rounded px-2 py-0.5 text-sm"
      />
      <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200 transition-colors disabled:opacity-50">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
      </button>
      <button onClick={() => setEditing(false)} className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-500 text-xs font-medium hover:bg-zinc-700 transition-colors">
        Cancel
      </button>
    </span>
  ) : (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      <button onClick={() => { setInput(value); setEditing(true) }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 text-xs font-medium hover:bg-brand-100 hover:text-brand-700 transition-colors">
        <Pencil className="w-3 h-3" /> Edit
      </button>
    </span>
  )
}

function BookingRow({ b }: { b: MinivanBookingDoc }) {
  const [open,      setOpen]      = useState(false)
  const [updating,  setUpdating]  = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [exporting, setExporting] = useState(false)

  const effectiveTimeFrom = b.adminTimeFrom ?? b.timeFrom
  const effectiveTimeTo   = b.adminTimeTo   ?? b.timeTo
  const effectiveDateFrom = b.adminDateFrom ?? b.dateFrom
  const effectiveDateTo   = b.adminDateTo   ?? b.dateTo

  async function saveTimeFrom(t: string) {
    await updateDoc(doc(db, 'minivan_bookings', b.id), {
      adminTimeFrom: t || null, scheduleModified: true, updatedAt: serverTimestamp(),
    })
  }
  async function saveTimeTo(t: string) {
    await updateDoc(doc(db, 'minivan_bookings', b.id), {
      adminTimeTo: t || null, scheduleModified: true, updatedAt: serverTimestamp(),
    })
  }
  async function saveDateFrom(d: string) {
    await updateDoc(doc(db, 'minivan_bookings', b.id), {
      adminDateFrom: d || null, scheduleModified: true, updatedAt: serverTimestamp(),
    })
  }
  async function saveDateTo(d: string) {
    await updateDoc(doc(db, 'minivan_bookings', b.id), {
      adminDateTo: d || null, scheduleModified: true, updatedAt: serverTimestamp(),
    })
  }

  async function exportPdf() {
    setExporting(true)
    try {
      const fn = httpsCallable<{ bookingId: string }, { pdf: string }>(functions, 'exportMinivanPdf')
      const result = await fn({ bookingId: b.id })
      const bytes = Uint8Array.from(atob(result.data.pdf), c => c.charCodeAt(0))
      const blob  = new Blob([bytes], { type: 'application/pdf' })
      const url   = URL.createObjectURL(blob)
      const a     = document.createElement('a')
      a.href      = url
      a.download  = `minivan-${effectiveDateFrom}-${b.destination.replace(/\s+/g, '-')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(false) }
  }

  async function setStatus(status: MinivanBookingDoc['status']) {
    setUpdating(true)
    try { await updateDoc(doc(db, 'minivan_bookings', b.id), { status, updatedAt: serverTimestamp() }) }
    finally { setUpdating(false) }
  }

  async function handleDelete() {
    if (!confirm(`Delete booking for ${b.contactPerson} to ${b.destination}?`)) return
    setDeleting(true)
    try { await deleteDoc(doc(db, 'minivan_bookings', b.id)) }
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
            <span className="text-sm font-semibold text-zinc-100 truncate">{b.contactPerson}</span>
            <span className="text-xs text-zinc-500 truncate">{b.destination}</span>
            <span className="text-xs text-zinc-400">
              {effectiveDateFrom} {effectiveTimeFrom} → {effectiveDateTo} {effectiveTimeTo}
              {b.scheduleModified && <span className="ml-1 text-amber-500">●</span>}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{b.studentName}</p>
        </div>
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0', STATUS_COLORS[b.status])}>
          {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-zinc-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-white/8 px-4 py-4 space-y-4">
          <div className="text-sm text-zinc-300 space-y-1.5">
            {b.vehicle && <p><span className="text-zinc-400">Vehicle:</span> {b.vehicle}</p>}
            <p><span className="text-zinc-400">Phone:</span> {b.phoneNumber}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-zinc-400">Departure:</span>
              <TimeEditor label={effectiveDateFrom} value={effectiveDateFrom} type="date" onSave={saveDateFrom} />
              <span className="text-zinc-400">at</span>
              <TimeEditor label={effectiveTimeFrom} value={effectiveTimeFrom} type="time" onSave={saveTimeFrom} />
              {b.scheduleModified && (
                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Admin updated</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-zinc-400">Return:</span>
              <TimeEditor label={effectiveDateTo} value={effectiveDateTo} type="date" onSave={saveDateTo} />
              <span className="text-zinc-400">at</span>
              <TimeEditor label={effectiveTimeTo} value={effectiveTimeTo} type="time" onSave={saveTimeTo} />
            </div>
            <p><span className="text-zinc-400">Destination:</span> {b.destination}</p>
            <p><span className="text-zinc-400">Purpose:</span> {b.purpose}</p>
            <p><span className="text-zinc-400">Driver:</span> {b.driverName}</p>
            {b.notes && <p><span className="text-zinc-400">Notes:</span> {b.notes}</p>}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {b.status === 'pending' && (
              <>
                <button
                  onClick={() => setStatus('approved')}
                  disabled={updating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/40 text-emerald-300 text-sm font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  onClick={() => setStatus('rejected')}
                  disabled={updating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/40 text-rose-300 text-sm font-medium hover:bg-rose-100 transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </>
            )}
            {b.status !== 'pending' && (
              <button
                onClick={() => setStatus('pending')}
                disabled={updating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                <Clock className="w-3.5 h-3.5" /> Reset
              </button>
            )}
            {b.status === 'approved' && (
              <button
                onClick={exportPdf}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-sm font-medium hover:bg-brand-100 transition-colors disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {exporting ? 'Exporting…' : 'Export PDF'}
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
  { id: 'all',      label: 'All'      },
  { id: 'pending',  label: 'Pending'  },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
]

// ── Vehicle row (name + lead days) ───────────────────────────────────────────

function VehicleRow({ v, onDelete, deleting }: { v: VehicleDoc; onDelete: () => void; deleting: boolean }) {
  const [editingDays, setEditingDays] = useState(false)
  const [daysInput,   setDaysInput]   = useState('')
  const [savingDays,  setSavingDays]  = useState(false)
  const leadDays = v.leadDays ?? 5

  async function saveDays() {
    const val = Math.max(1, parseInt(daysInput, 10) || 5)
    setSavingDays(true)
    try {
      await updateDoc(doc(db, 'vehicles', v.id), { leadDays: val })
      setEditingDays(false)
    } finally { setSavingDays(false) }
  }

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-white/8 bg-zinc-900/50">
      <div className="flex items-center gap-2 min-w-0">
        <Car className="w-4 h-4 text-zinc-400 flex-shrink-0" />
        <span className="text-sm font-medium text-zinc-300 truncate">{v.name}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {editingDays ? (
          <span className="flex items-center gap-1.5">
            <input
              autoFocus
              type="number"
              min={1}
              max={30}
              value={daysInput}
              onChange={e => setDaysInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveDays(); if (e.key === 'Escape') setEditingDays(false) }}
              className="border border-white/15 rounded px-2 py-0.5 text-xs w-14 text-center"
            />
            <span className="text-xs text-zinc-500 whitespace-nowrap">working days in advance</span>
            <button onClick={saveDays} disabled={savingDays}
              className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-40">
              {savingDays ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            </button>
            <button onClick={() => setEditingDays(false)} className="p-1 text-zinc-400 hover:text-zinc-400">
              <X className="w-3 h-3" />
            </button>
          </span>
        ) : (
          <button
            onClick={() => { setDaysInput(String(leadDays)); setEditingDays(true) }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-700 text-zinc-400 text-xs font-medium hover:bg-brand-100 hover:text-brand-700 transition-colors"
            title="Working days in advance required to book"
          >
            <Pencil className="w-3 h-3" /> {leadDays} working days
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={deleting}
          className="p-1 text-zinc-400 hover:text-rose-500 transition-colors disabled:opacity-40"
        >
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}

// ── Vehicle manager ───────────────────────────────────────────────────────────

function VehicleManager() {
  const { data: vehicles } = useCollection<VehicleDoc>('vehicles', [orderBy('order')])
  const [adding,    setAdding]    = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [saving,    setSaving]    = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function addVehicle() {
    const name = nameInput.trim()
    if (!name) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'vehicles'), {
        name,
        isActive: true,
        order: vehicles.length,
        createdAt: serverTimestamp(),
      })
      setNameInput('')
      setAdding(false)
    } finally { setSaving(false) }
  }

  async function deleteVehicle(id: string) {
    setDeletingId(id)
    try { await deleteDoc(doc(db, 'vehicles', id)) }
    finally { setDeletingId(null) }
  }

  return (
    <section className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-200">Vehicles</p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-xs font-medium hover:bg-brand-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add vehicle
          </button>
        )}
      </div>

      {vehicles.length === 0 && !adding && (
        <p className="text-sm text-zinc-400">No vehicles yet. Add one to let students book.</p>
      )}

      <div className="space-y-2">
        {vehicles.map(v => (
          <VehicleRow key={v.id} v={v} onDelete={() => deleteVehicle(v.id)} deleting={deletingId === v.id} />
        ))}
      </div>

      {adding && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addVehicle(); if (e.key === 'Escape') setAdding(false) }}
            className="input flex-1 text-sm py-1.5"
            placeholder="Vehicle name, e.g. Minivan"
          />
          <button onClick={addVehicle} disabled={saving || !nameInput.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-40 transition-colors">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Add
          </button>
          <button onClick={() => setAdding(false)}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 text-xs font-medium hover:bg-zinc-700 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </section>
  )
}

export default function MinivanBookings() {
  const { data: bookings, loading } = useCollection<MinivanBookingDoc>('minivan_bookings', [
    orderBy('createdAt', 'desc'),
  ])
  const [filter, setFilter] = useState<FilterStatus>('all')

  const visible = filter === 'all' ? bookings : bookings.filter(b => b.status === filter)

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Car className="w-6 h-6 text-brand-500" />
        <div>
          <h1 className="page-title">Vehicles</h1>
          <p className="text-zinc-500 text-sm">Manage vehicles and student booking requests.</p>
        </div>
      </div>

      <VehicleManager />

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
                {bookings.filter(b => b.status === f.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">No requests.</div>
      ) : (
        <div className="space-y-2">
          {visible.map(b => <BookingRow key={b.id} b={b} />)}
        </div>
      )}
    </div>
  )
}
