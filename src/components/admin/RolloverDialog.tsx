import { useEffect, useMemo, useRef, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { X, Loader2, Check, Archive, ArrowRight, Copy } from 'lucide-react'
import { suggestNextClass, graduatesByDefault, type NextClassDraft } from '@/lib/classRollover'
import type { CohortDoc, UserDoc } from '@/types'
import { cn } from '@/lib/utils'
import { useCohorts } from '@/lib/queries'

// End of the school year for one class: either its students continue in a new
// class (created here, students moved, old class archived) or the class has
// finished and is archived. The archived class keeps its lessons, results and
// roster for history.

const rollover = httpsCallable<{
  cohortId: string; moveStudentIds?: string[]; deactivateStudentIds?: string[]
  next?: NextClassDraft & { copyTeachers: boolean }
}, { nextCohortId: string | null; moved: number; deactivated: number; skipped: number; invitesMoved: number; qrInvitesClosed: number }>(functions, 'rolloverClass')

export default function RolloverDialog({ cohort, students, onClose, onCopyPlan }: {
  cohort: CohortDoc
  students: UserDoc[]                 // the class's students
  onClose: () => void
  onCopyPlan: (toCohortId: string) => void
}) {
  const [mode, setMode] = useState<'continue' | 'graduate'>(graduatesByDefault(cohort) ? 'graduate' : 'continue')
  const [draft, setDraft] = useState<NextClassDraft>(() => suggestNextClass(cohort))
  const [copyTeachers, setCopyTeachers] = useState(true)
  const active = useMemo(() => students.filter(s => s.isActive !== false), [students])
  const [moving, setMoving] = useState<Set<string>>(() => new Set(active.map(s => s.id)))
  const [deactivate, setDeactivate] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ nextCohortId: string | null; moved: number; deactivated: number; invitesMoved: number; qrInvitesClosed: number } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const { data: current } = useCohorts()
  const nameTaken = current.find(c => c.id !== cohort.id && c.name.trim().toLowerCase() === draft.name.trim().toLowerCase())

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const set = <K extends keyof NextClassDraft>(k: K, v: NextClassDraft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const toggle = (id: string) => setMoving(m => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n })

  const valid = mode === 'graduate' || (!nameTaken && draft.name.trim().length >= 2 && draft.startDate && draft.endDate && draft.endDate >= draft.startDate)
  const confirmed = confirmText.trim().toLowerCase() === cohort.name.trim().toLowerCase()

  async function submit() {
    setBusy(true); setError('')
    try {
      const { data } = await rollover(mode === 'continue'
        ? { cohortId: cohort.id, moveStudentIds: [...moving], next: { ...draft, name: draft.name.trim(), copyTeachers } }
        : { cohortId: cohort.id, deactivateStudentIds: deactivate ? active.map(s => s.id) : [] })
      setDone(data)
    } catch (e: any) {
      setError(e?.message ?? 'Rollover failed.')
    } finally {
      setBusy(false)
    }
  }

  const dateField = (k: keyof NextClassDraft, label: string) => (
    <div>
      <label htmlFor={`ro-${k}`} className="label text-xs">{label}</label>
      <input id={`ro-${k}`} type="date" className="input text-sm" value={draft[k] as string} onChange={e => set(k, e.target.value as never)} />
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !busy && onClose()}>
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ro-title" tabIndex={-1}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-5 space-y-5 outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ro-title" className="text-base font-semibold text-zinc-100">End of year: {cohort.name}</h2>
            <p className="text-xs text-zinc-500 mt-1">
              The class is archived: it disappears from class pickers but keeps its lessons, results and student list.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4" aria-live="polite">
            <p className="text-sm text-emerald-300 flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                {cohort.name} is archived.
                {done.nextCohortId && ` ${done.moved} ${done.moved === 1 ? 'student' : 'students'} moved to ${draft.name}.`}
                {done.deactivated > 0 && ` ${done.deactivated} students marked inactive.`}
                {done.invitesMoved > 0 && ` ${done.invitesMoved} pending ${done.invitesMoved === 1 ? 'invite now joins' : 'invites now join'} ${draft.name}.`}
                {done.qrInvitesClosed > 0 && ' The class QR sign-up code is switched off.'}
              </span>
            </p>
            {done.nextCohortId && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                <p className="text-sm text-zinc-200">Next: fill {draft.name}'s calendar</p>
                <p className="text-xs text-zinc-500">
                  Copy last year's plan for this year group — for example the lessons the previous year-{draft.programYear} class had.
                </p>
                <button onClick={() => onCopyPlan(done.nextCohortId!)} className="btn-primary py-2 text-sm">
                  <Copy className="w-4 h-4" /> Copy last year's plan
                </button>
              </div>
            )}
            <button onClick={onClose} className="btn-secondary py-2 text-sm">Close</button>
          </div>
        ) : (
          <>
            <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <legend className="sr-only">What happens to the class</legend>
              {([
                ['continue', 'Students continue', 'Create the class they continue in and move them there.', ArrowRight],
                ['graduate', 'The class has finished', 'Archive it. Nobody moves on.', Archive],
              ] as const).map(([value, title, text, Icon]) => (
                <label key={value} className={cn('rounded-xl border p-3 cursor-pointer flex gap-3',
                  mode === value ? 'border-brand-500/60 bg-brand-500/10' : 'border-white/10 hover:bg-white/5')}>
                  <input type="radio" name="ro-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
                  <span>
                    <span className="text-sm font-medium text-zinc-100 flex items-center gap-1.5"><Icon className="w-4 h-4" aria-hidden="true" /> {title}</span>
                    <span className="text-xs text-zinc-500">{text}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {mode === 'continue' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label htmlFor="ro-name" className="label text-xs">New class name</label>
                    <input id="ro-name" className="input text-sm" value={draft.name} onChange={e => set('name', e.target.value)} />
                    {nameTaken && (
                      <p className="text-[11px] text-amber-300 mt-1">
                        {nameTaken.name} already exists. End that class's year first (it's archived then), or choose another name.
                      </p>
                    )}
                    {!nameTaken && draft.name.trim() === cohort.name.trim() && (
                      <p className="text-[11px] text-zinc-500 mt-1">Same name as now — fine, the old class is archived. Add a year to tell them apart if you like.</p>
                    )}
                  </div>
                  {dateField('startDate', 'Start date')}
                  {dateField('endDate', 'End date')}
                  {dateField('semesterStartDate', 'Semester 1 starts (optional)')}
                  {dateField('semesterEndDate', 'Semester 1 ends (optional)')}
                  {dateField('semesterSem2StartDate', 'Semester 2 starts (optional)')}
                  {dateField('semesterSem2EndDate', 'Semester 2 ends (optional)')}
                  <div>
                    <label htmlFor="ro-year" className="label text-xs">Program year</label>
                    <select id="ro-year" className="input text-sm" value={draft.programYear} onChange={e => set('programYear', Number(e.target.value) as 1 | 2)}>
                      <option value={1}>Year 1</option>
                      <option value={2}>Year 2</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-zinc-300 self-end pb-2">
                    <input type="checkbox" checked={copyTeachers} onChange={e => setCopyTeachers(e.target.checked)} />
                    Same teachers as now
                  </label>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="label text-xs mb-0">Students moving ({moving.size} of {active.length})</p>
                    <button type="button" className="text-xs text-brand-400 hover:text-brand-300"
                      onClick={() => setMoving(moving.size === active.length ? new Set() : new Set(active.map(s => s.id)))}>
                      {moving.size === active.length ? 'None' : 'All'}
                    </button>
                  </div>
                  {active.length === 0 ? <p className="text-xs text-zinc-500">No active students in this class.</p> : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-y-auto rounded-xl border border-white/10 p-2">
                      {active.map(s => (
                        <label key={s.id} className="flex items-center gap-2 text-sm text-zinc-300 px-1.5 py-1 rounded hover:bg-white/5">
                          <input type="checkbox" checked={moving.has(s.id)} onChange={() => toggle(s.id)} /> {s.displayName}
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-500 mt-1">Students you untick stay in the archived class — move them later from Users.</p>
                </div>
              </div>
            )}

            {mode === 'graduate' && (
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input type="checkbox" checked={deactivate} onChange={e => setDeactivate(e.target.checked)} className="mt-1" />
                <span>
                  Mark the {active.length} students inactive
                  <span className="block text-xs text-zinc-500">They can still sign in and see their work, but drop out of student lists and attendance.</span>
                </span>
              </label>
            )}

            <div className="border-t border-white/10 pt-4 space-y-2">
              <label htmlFor="ro-confirm" className="label text-xs">Type the class name to confirm: <b className="text-zinc-300">{cohort.name}</b></label>
              <input id="ro-confirm" className="input text-sm" value={confirmText} onChange={e => setConfirmText(e.target.value)} autoComplete="off" />
              <button onClick={submit} disabled={!valid || !confirmed || busy} className="btn-primary py-2 w-full justify-center disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'continue' ? <ArrowRight className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                {mode === 'continue' ? `Create ${draft.name.trim() || 'new class'}, move ${moving.size} and archive` : `Archive ${cohort.name}`}
              </button>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  )
}
