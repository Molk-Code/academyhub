import { useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useDocument } from '@/hooks/useFirestore'
import type { BookingSettingsDoc } from '@/types'
import { format } from 'date-fns'
import { UtensilsCrossed, CheckCircle2, AlertCircle, Info, X, Plus } from 'lucide-react'

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

function minPickupDateStr(leadDays: number): string {
  return format(addWorkingDays(new Date(), leadDays), 'yyyy-MM-dd')
}

interface FormState {
  date: string
  pickupTime: string
  lunchStudents: string[]
  lunchCanHeat: '' | 'yes' | 'no'
  dinnerStudents: string[]
  dinnerCanHeat: '' | 'yes' | 'no'
  otherNotes: string
  contactPerson: string
  phoneNumber: string
}

const EMPTY: FormState = {
  date: minPickupDateStr(5),
  pickupTime: '',
  lunchStudents: [],
  lunchCanHeat: '',
  dinnerStudents: [],
  dinnerCanHeat: '',
  otherNotes: '',
  contactPerson: '',
  phoneNumber: '',
}

function StudentInput({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (names: string[]) => void
}) {
  const [input, setInput] = useState('')

  function add() {
    const name = input.trim()
    if (!name || selected.includes(name)) return
    onChange([...selected, name])
    setInput('')
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          className="input flex-1"
          placeholder="Type a name and press Enter…"
        />
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 px-3 py-2 rounded-xl border border-white/10 bg-zinc-900 text-sm text-brand-600 font-medium hover:bg-brand-50 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(name => (
            <span key={name} className="flex items-center gap-1 bg-brand-50 text-brand-700 text-xs font-medium px-2.5 py-1 rounded-full border border-brand-100">
              {name}
              <button type="button" onClick={() => onChange(selected.filter(n => n !== name))} className="hover:text-brand-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FoodBoxOrder({ standalone = false }: { standalone?: boolean }) {
  const { profile, cohortId } = useAuth()
  const { data: settings } = useDocument<BookingSettingsDoc>('settings', 'booking')
  const leadDays = settings?.foodBoxLeadDays ?? 5

  const [form, setForm] = useState<FormState>({ ...EMPTY, contactPerson: profile?.displayName ?? '' })
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const tooSoon = !!form.date && form.date < minPickupDateStr(leadDays)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (!form.lunchStudents.length && !form.dinnerStudents.length) return
setSubmitting(true)
    setStatus('idle')
    try {
      await addDoc(collection(db, 'food_box_orders'), {
        studentId:       profile.uid,
        studentName:     profile.displayName ?? '',
        studentEmail:    profile.schoolEmail ?? profile.email ?? '',
        cohortId:        cohortId ?? null,
        date:            form.date,
        pickupTime:      form.pickupTime || null,
        morningStudents: [],
        morningDiet:     '',
        lunchStudents:   form.lunchStudents,
        lunchCanHeat:    form.lunchCanHeat === '' ? null : form.lunchCanHeat === 'yes',
        lunchDiet:       '',
        dinnerStudents:  form.dinnerStudents,
        dinnerCanHeat:   form.dinnerCanHeat === '' ? null : form.dinnerCanHeat === 'yes',
        dinnerDiet:      '',
        otherNotes:      form.otherNotes.trim(),
        contactPerson:   form.contactPerson.trim(),
        phoneNumber:     form.phoneNumber.trim(),
        status:          'pending',
        createdAt:       serverTimestamp(),
      })
      setStatus('success')
      setForm({ ...EMPTY, date: minPickupDateStr(leadDays), pickupTime: '', contactPerson: profile.displayName ?? '' })
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
            <h2 className="text-xl font-bold text-zinc-100">Order submitted!</h2>
            <p className="text-zinc-500 text-sm mt-1">
              Your food box order has been sent. Remember to submit at least 5 working days before the date.
            </p>
          </div>
          <button onClick={() => setStatus('idle')} className="btn-primary py-2.5 px-6">Place another order</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {standalone && (
        <div>
          <h1 className="page-title">Food Box Order</h1>
          <p className="text-zinc-500 text-sm mt-1">Order food from the school restaurant for on-location shoots.</p>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Submit at least <span className="underline">{leadDays} working days</span> before the date.
        </p>
      </div>

      {status === 'error' && (
        <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/50 rounded-xl px-4 py-3 text-rose-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {errorMsg}
        </div>
      )}

      <form onSubmit={submit} className="space-y-6">

        {/* Date & Pick-up time */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <UtensilsCrossed className="w-4 h-4 text-brand-500" />
            <p className="text-sm font-semibold text-zinc-200">Date & Pick-up time</p>
          </div>
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[140px] max-w-[180px]">
              <label className="label text-xs">Shoot date *</label>
              <input
                type="date"
                required
                value={form.date}
                min={minPickupDateStr(leadDays)}
                onChange={e => {
                  const min = minPickupDateStr(leadDays)
                  set('date', e.target.value < min ? min : e.target.value)
                }}
                className="input w-full"
              />
            </div>
            <div className="flex-1 min-w-[120px] max-w-[160px]">
              <label className="label text-xs">Pick-up time</label>
              <input
                type="time"
                value={form.pickupTime}
                onChange={e => set('pickupTime', e.target.value)}
                className="input w-full"
                placeholder="e.g. 11:30"
              />
            </div>
          </div>
        </div>

        {/* Lunchbox */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-3">
          <p className="text-sm font-semibold text-zinc-200">🥗 Lunchbox</p>
          <StudentInput
            selected={form.lunchStudents}
            onChange={v => set('lunchStudents', v)}
          />
          <div>
            <label className="label text-xs">Can you heat up the food?</label>
            <div className="flex gap-3 mt-1">
              {(['yes', 'no'] as const).map(v => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="lunchHeat"
                    value={v}
                    checked={form.lunchCanHeat === v}
                    onChange={() => set('lunchCanHeat', v)}
                    className="accent-brand-600"
                  />
                  <span className="text-sm text-zinc-300 capitalize">{v}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Dinnerbox */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-3">
          <p className="text-sm font-semibold text-zinc-200">🍽️ Dinnerbox</p>
          <StudentInput
            selected={form.dinnerStudents}
            onChange={v => set('dinnerStudents', v)}
          />
          <div>
            <label className="label text-xs">Can you heat up the food?</label>
            <div className="flex gap-3 mt-1">
              {(['yes', 'no'] as const).map(v => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="dinnerHeat"
                    value={v}
                    checked={form.dinnerCanHeat === v}
                    onChange={() => set('dinnerCanHeat', v)}
                    className="accent-brand-600"
                  />
                  <span className="text-sm text-zinc-300 capitalize">{v}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Other notes */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-3">
          <p className="text-sm font-semibold text-zinc-200">Other Notes</p>
          <textarea
            value={form.otherNotes}
            onChange={e => set('otherNotes', e.target.value)}
            rows={3}
            className="input w-full resize-none"
            placeholder="Any additional information…"
          />
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
        </div>

        <button
          type="submit"
          disabled={submitting || tooSoon || !form.date || !form.contactPerson || !form.phoneNumber ||
            (!form.lunchStudents.length && !form.dinnerStudents.length)}
          className="w-full btn-primary py-3 text-base disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Submitting…' : 'Submit Food Box Order'}
        </button>
      </form>
    </div>
  )
}
