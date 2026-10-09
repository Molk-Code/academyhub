import { useState } from 'react'
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import type { ProductionPeriodDoc, CohortDoc } from '@/types'
import { Settings, X, Check, AlertTriangle } from 'lucide-react'
import { eachDayOfInterval, format, isWeekend, parseISO } from 'date-fns'

export function PeriodForm({ cohortId, cohorts, existing, onClose }: {
  cohortId: string
  cohorts: CohortDoc[]
  existing: ProductionPeriodDoc | null
  onClose: () => void
}) {
  const { profile } = useAuth()
  const [formCohortId,       setFormCohortId]       = useState(existing?.cohortId ?? cohortId)
  const [title,              setTitle]              = useState(existing?.title ?? '')
  const [startDate,          setStartDate]          = useState(existing?.startDate ?? '')
  const [endDate,            setEndDate]            = useState(existing?.endDate ?? '')
  const [notes,              setNotes]              = useState(existing?.notes ?? '')
  const [budgetPerProduction,setBudgetPerProduction] = useState(existing?.budgetPerProduction != null ? String(existing.budgetPerProduction) : '')
  const [budgetCurrency,     setBudgetCurrency]     = useState(existing?.budgetCurrency ?? 'SEK')
  const [budgetNotes,        setBudgetNotes]        = useState(existing?.budgetNotes ?? '')
  const [saving,             setSaving]             = useState(false)
  const [error,              setError]              = useState<string | null>(null)

  async function handleSave() {
    if (!title.trim() || !startDate || !endDate) return
    if (!formCohortId) { setError('No class selected. Please choose a class first.'); return }
    setSaving(true)
    setError(null)

    // Auto-generate workingDays = all weekdays in range
    let workingDays: string[] = []
    if (!existing) {
      try {
        const dates = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })
        workingDays = dates
          .filter(d => !isWeekend(d))
          .map(d => format(d, 'yyyy-MM-dd'))
      } catch {}
    }

    const payload = {
      title:   title.trim(),
      cohortId: formCohortId,
      startDate,
      endDate,
      notes:   notes.trim(),
      budgetPerProduction: budgetPerProduction !== '' ? Number(budgetPerProduction) : null,
      budgetCurrency:      budgetCurrency.trim() || 'SEK',
      budgetNotes:         budgetNotes.trim(),
      ...(existing ? {} : { workingDays, createdBy: profile?.uid ?? '' }),
    }
    try {
      if (existing) {
        await updateDoc(doc(db, 'production_periods', existing.id), payload)
      } else {
        await addDoc(collection(db, 'production_periods'), { ...payload, createdAt: serverTimestamp() })
      }
      onClose()
    } catch (e: any) {
      console.error(e)
      setError(e?.message ?? 'Failed to save. Check your permissions.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <Settings className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-semibold text-zinc-100 flex-1">
            {existing ? 'Edit production period' : 'New production period'}
          </h2>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Class</label>
            {existing ? (
              <p className="text-sm text-zinc-300 bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2">
                {cohorts.find(c => c.id === formCohortId)?.name ?? 'Unknown class'}
              </p>
            ) : (
              <select value={formCohortId} onChange={e => setFormCohortId(e.target.value)} className="input">
                <option value="">Select a class…</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="label">Title</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Spring Production Period 2025"
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input [color-scheme:dark]" />
            </div>
            <div>
              <label className="label">End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input [color-scheme:dark]" />
            </div>
          </div>
          {!existing && (
            <p className="text-xs text-zinc-500">All weekdays in the date range will be set as working days. You can toggle individual days afterwards by clicking the column header.</p>
          )}
          <div>
            <label className="label">Notes <span className="text-zinc-500 font-normal">(optional)</span></label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input resize-none" placeholder="Any period-level notes…" />
          </div>
          <div className="border-t border-white/8 pt-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">💰 Budget</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label">Budget per production <span className="text-zinc-500 font-normal">(optional)</span></label>
                <input
                  type="number" min={0}
                  value={budgetPerProduction}
                  onChange={e => setBudgetPerProduction(e.target.value)}
                  className="input"
                  placeholder="e.g. 15000"
                />
              </div>
              <div className="w-24">
                <label className="label">Currency</label>
                <input value={budgetCurrency} onChange={e => setBudgetCurrency(e.target.value)} className="input" placeholder="SEK" />
              </div>
            </div>
            <div>
              <label className="label">Budget notes <span className="text-zinc-500 font-normal">(optional)</span></label>
              <textarea value={budgetNotes} onChange={e => setBudgetNotes(e.target.value)} rows={2} className="input resize-none" placeholder="What the budget covers, rules, etc." />
            </div>
          </div>
        </div>
        {error && (
          <div className="mx-5 mb-2 flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10">
          <button onClick={handleSave} disabled={saving || !title.trim() || !startDate || !endDate || !formCohortId}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-500 rounded-xl transition-colors disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> {existing ? 'Save' : 'Create'}
          </button>
          <button onClick={onClose} className="ml-auto text-sm text-zinc-500 hover:text-zinc-300 px-3 py-2">Cancel</button>
        </div>
      </div>
    </div>
  )
}
