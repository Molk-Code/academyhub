import { useState, useMemo } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { VehicleDoc } from '@/types'
import { format } from 'date-fns'
import { Car, CheckCircle2, AlertCircle, Info } from 'lucide-react'

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

function todayStr() { return format(new Date(), 'yyyy-MM-dd') }
function minDateStr(leadDays: number) { return format(addWorkingDays(new Date(), leadDays), 'yyyy-MM-dd') }

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
  dateFrom: todayStr(),
  timeFrom: '',
  dateTo: todayStr(),
  timeTo: '',
  destination: '',
  purpose: '',
  driverName: '',
  contactPerson: '',
  phoneNumber: '',
  notes: '',
}

export default function MinivanBooking({ standalone = false }: { standalone?: boolean }) {
  const { profile, cohortId } = useAuth()
  const { data: vehicles } = useCollection<VehicleDoc>('vehicles', [orderBy('order')])
  const [form, setForm] = useState<FormState>({ ...EMPTY, contactPerson: profile?.displayName ?? '' })

  const selectedVehicle = useMemo(() => vehicles.find(v => v.name === form.vehicle), [vehicles, form.vehicle])
  const leadDays = selectedVehicle?.leadDays ?? 5
  const minDate  = form.vehicle ? minDateStr(leadDays) : todayStr()
  const tooSoon  = !!form.vehicle && !!form.dateFrom && form.dateFrom < minDate
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
      const payload = {
        studentId:     profile.uid,
        studentName:   profile.displayName ?? '',
        studentEmail:  profile.schoolEmail ?? profile.email ?? '',
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
      }
      await addDoc(collection(db, 'minivan_bookings'), payload)

      setStatus('success')
      setForm({ ...EMPTY, contactPerson: profile.displayName ?? '' })
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
            <p className="text-zinc-500 text-sm mt-1">
              Your vehicle booking request has been sent. You'll be contacted once it's confirmed.
            </p>
          </div>
          <button onClick={() => setStatus('idle')} className="btn-primary py-2.5 px-6">Place another request</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {standalone && (
        <div>
          <h1 className="page-title">Vehicle Booking</h1>
          <p className="text-zinc-500 text-sm mt-1">Request a school vehicle for on-location shoots and trips.</p>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {form.vehicle
            ? <>Submit at least <span className="underline">{leadDays} working days</span> in advance for {form.vehicle}. Approval required before use.</>
            : <>Select a vehicle to see how far in advance you need to book. Approval required before use.</>
          }
        </p>
      </div>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/50 rounded-xl px-4 py-3 text-rose-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {errorMsg}
        </div>
      )}

      <form onSubmit={submit} className="space-y-6">

        {/* Trip dates */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Car className="w-4 h-4 text-brand-500" />
            <p className="text-sm font-semibold text-zinc-200">Trip Details</p>
          </div>
          <div>
            <label className="label text-xs">Vehicle *</label>
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label text-xs">Departure date *</label>
              <input
                type="date"
                required
                value={form.dateFrom}
                min={minDate}
                onChange={e => set('dateFrom', e.target.value < minDate ? minDate : e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="label text-xs">Departure time *</label>
              <input
                type="time"
                required
                value={form.timeFrom}
                onChange={e => set('timeFrom', e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="label text-xs">Return date *</label>
              <input
                type="date"
                required
                value={form.dateTo}
                onChange={e => set('dateTo', e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="label text-xs">Return time *</label>
              <input
                type="time"
                required
                value={form.timeTo}
                onChange={e => set('timeTo', e.target.value)}
                className="input w-full"
              />
            </div>
          </div>
          <div>
            <label className="label text-xs">Destination *</label>
            <input
              required
              value={form.destination}
              onChange={e => set('destination', e.target.value)}
              className="input w-full"
              placeholder="e.g. Stockholm City, Gothenburg"
            />
          </div>
          <div>
            <label className="label text-xs">Purpose / Project *</label>
            <textarea
              required
              value={form.purpose}
              onChange={e => set('purpose', e.target.value)}
              rows={2}
              className="input w-full resize-none"
              placeholder="e.g. Documentary shoot – Karlstad harbour"
            />
          </div>
          <div>
            <label className="label text-xs">Driver name *</label>
            <input
              required
              value={form.driverName}
              onChange={e => set('driverName', e.target.value)}
              className="input w-full"
              placeholder="Full name of driver"
            />
          </div>
        </div>

        {/* Contact */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
          <p className="text-sm font-semibold text-zinc-200">Contact Information</p>
          <div>
            <label className="label text-xs">Contact person *</label>
            <input
              required
              value={form.contactPerson}
              onChange={e => set('contactPerson', e.target.value)}
              className="input w-full"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="label text-xs">Phone number *</label>
            <input
              required
              type="tel"
              value={form.phoneNumber}
              onChange={e => set('phoneNumber', e.target.value)}
              className="input w-full"
              placeholder="+46 70 000 00 00"
            />
          </div>
          <div>
            <label className="label text-xs">Additional notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className="input w-full resize-none"
              placeholder="Any other information…"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || tooSoon || !form.vehicle || !form.dateFrom || !form.timeFrom || !form.dateTo || !form.timeTo || !form.destination || !form.purpose || !form.driverName || !form.contactPerson || !form.phoneNumber}
          className="w-full btn-primary py-3 text-base"
        >
          {submitting ? 'Submitting…' : 'Submit Vehicle Request'}
        </button>
      </form>
    </div>
  )
}
