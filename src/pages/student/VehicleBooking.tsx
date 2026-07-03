import { useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy, where } from '@/hooks/useFirestore'
import type { VehicleDoc } from '@/types'
import { Car, CheckCircle2, AlertCircle } from 'lucide-react'

function addWorkingDays(start: Date, days: number): Date {
  const d = new Date(start)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return d
}

function minDateStr(leadDays: number): string {
  const d = addWorkingDays(new Date(), leadDays)
  return d.toISOString().slice(0, 10)
}

interface FormState {
  vehicle: string
  dateFrom: string
  timeFrom: string
  dateTo: string
  timeTo: string
  destination: string
  purpose: string
  driverName: string
  contactPerson: string
  phoneNumber: string
  notes: string
}

const EMPTY: FormState = {
  vehicle: '',
  dateFrom: '',
  timeFrom: '',
  dateTo: '',
  timeTo: '',
  destination: '',
  purpose: '',
  driverName: '',
  contactPerson: '',
  phoneNumber: '',
  notes: '',
}

export default function VehicleBooking() {
  const { profile, cohortId } = useAuth()
  const { data: vehicles } = useCollection<VehicleDoc>(
    'vehicles',
    [where('isActive', '==', true), orderBy('order')],
  )

  const leadDays = 3
  const minDate = minDateStr(leadDays)

  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    contactPerson: profile?.displayName ?? '',
    driverName: profile?.displayName ?? '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setSubmitting(true)
    setStatus('idle')
    try {
      await addDoc(collection(db, 'minivan_bookings'), {
        studentId:     profile.uid,
        studentName:   profile.displayName ?? '',
        cohortId:      cohortId ?? null,
        vehicle:       form.vehicle,
        dateFrom:      form.dateFrom,
        timeFrom:      form.timeFrom,
        dateTo:        form.dateTo,
        timeTo:        form.timeTo,
        destination:   form.destination.trim(),
        purpose:       form.purpose.trim(),
        driverName:    form.driverName.trim(),
        contactPerson: form.contactPerson.trim(),
        phoneNumber:   form.phoneNumber.trim(),
        notes:         form.notes.trim(),
        status:        'pending',
        createdAt:     serverTimestamp(),
      })
      setStatus('success')
      setForm({ ...EMPTY, contactPerson: profile.displayName ?? '', driverName: profile.displayName ?? '' })
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err?.message ?? 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'success') {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-10 flex flex-col items-center text-center gap-4">
          <CheckCircle2 className="w-16 h-16 text-emerald-500" />
          <div>
            <h2 className="text-xl font-bold text-zinc-100">Request submitted!</h2>
            <p className="text-zinc-500 text-sm mt-1">Your vehicle booking request is pending admin approval.</p>
          </div>
          <button onClick={() => setStatus('idle')} className="btn-primary py-2.5 px-6">Book another vehicle</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="page-title">Vehicle Booking</h1>
        <p className="text-zinc-500 text-sm mt-1">Request a vehicle for your production. Requires admin approval.</p>
      </div>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/50 rounded-xl px-4 py-3 text-rose-300 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {errorMsg}
        </div>
      )}

      <form onSubmit={submit} className="space-y-5">

        {/* Vehicle */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Car className="w-4 h-4 text-brand-500" />
            <p className="text-sm font-semibold text-zinc-200">Vehicle</p>
          </div>
          <select
            required
            value={form.vehicle}
            onChange={e => set('vehicle', e.target.value)}
            className="input w-full"
          >
            <option value="">Select a vehicle…</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.name}>{v.name}</option>
            ))}
          </select>
        </div>

        {/* Dates & Times */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
          <p className="text-sm font-semibold text-zinc-200">Pickup & Return</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">From date *</label>
              <input type="date" required min={minDate} value={form.dateFrom}
                onChange={e => set('dateFrom', e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="label text-xs">From time *</label>
              <input type="time" required value={form.timeFrom}
                onChange={e => set('timeFrom', e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="label text-xs">To date *</label>
              <input type="date" required min={form.dateFrom || minDate} value={form.dateTo}
                onChange={e => set('dateTo', e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="label text-xs">To time *</label>
              <input type="time" required value={form.timeTo}
                onChange={e => set('timeTo', e.target.value)} className="input w-full" />
            </div>
          </div>
        </div>

        {/* Trip details */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
          <p className="text-sm font-semibold text-zinc-200">Trip Details</p>
          <div>
            <label className="label text-xs">Destination *</label>
            <input required value={form.destination} onChange={e => set('destination', e.target.value)}
              className="input w-full" placeholder="Where are you going?" />
          </div>
          <div>
            <label className="label text-xs">Purpose *</label>
            <input required value={form.purpose} onChange={e => set('purpose', e.target.value)}
              className="input w-full" placeholder="What's the trip for?" />
          </div>
          <div>
            <label className="label text-xs">Driver name *</label>
            <input required value={form.driverName} onChange={e => set('driverName', e.target.value)}
              className="input w-full" placeholder="Who will be driving?" />
          </div>
          <div>
            <label className="label text-xs">Additional notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={3} className="input w-full resize-none" placeholder="Any extra information…" />
          </div>
        </div>

        {/* Contact */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
          <p className="text-sm font-semibold text-zinc-200">Contact Information</p>
          <div>
            <label className="label text-xs">Contact person *</label>
            <input required value={form.contactPerson} onChange={e => set('contactPerson', e.target.value)}
              className="input w-full" placeholder="Your name" />
          </div>
          <div>
            <label className="label text-xs">Phone number *</label>
            <input required type="tel" value={form.phoneNumber} onChange={e => set('phoneNumber', e.target.value)}
              className="input w-full" placeholder="+46 70 000 00 00" />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || !form.vehicle || !form.dateFrom || !form.timeFrom ||
            !form.dateTo || !form.timeTo || !form.destination || !form.purpose ||
            !form.driverName || !form.contactPerson || !form.phoneNumber}
          className="w-full btn-primary py-3 text-base disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Submitting…' : 'Request Vehicle'}
        </button>
      </form>
    </div>
  )
}
