import { useEffect, useMemo, useRef, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCohorts } from '@/lib/queries'
import { X, Loader2, Check, Copy } from 'lucide-react'
import type { CohortDoc } from '@/types'
import { lastYearsClass, defaultShiftWeeks } from '@/lib/classRollover'

// "Copy last year's plan": a class's lessons and assignments for a period,
// moved forward by whole weeks (a Monday lesson stays on a Monday) into
// another class, plus the subjects it could see. Preview first; copying
// again later only adds what's missing.

interface CopyResult {
  ok: boolean; dryRun?: boolean
  lessons: { found: number; toCopy: number; alreadyCopied: number }
  assignments: { found: number; toCopy: number; alreadyCopied: number }
  subjects: number
  sample: { title: string; from: string; to: string }[]
}

const copyPlan = httpsCallable<{
  fromCohortId: string; toCohortId: string; from: string; to: string; shiftDays: number
  lessons: boolean; assignments: boolean; subjects: boolean; dryRun: boolean
}, CopyResult>(functions, 'copyClassPlan')

const iso = (d: Date) => d.toLocaleDateString('sv-SE')
const tsIso = (t: CohortDoc['startDate'] | undefined) => (t?.toDate ? iso(t.toDate()) : '')
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const when = (s: string) => new Date(s).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function CopyPlanDialog({ onClose, toCohortId: initialTo, fromCohortId: initialFrom }: {
  onClose: () => void; toCohortId?: string; fromCohortId?: string
}) {
  const { profile, roles, role } = useAuth()
  const isAdmin = roles.includes('admin') || role === 'admin'
  const { data: active, all, cohortOf } = useCohorts()
  // Teachers fill classes they teach; admins any current class
  const targets = useMemo(
    () => active.filter(c => isAdmin || c.teacherIds?.includes(profile?.uid ?? '')),
    [active, isAdmin, profile?.uid])

  const [toId, setToId] = useState(initialTo ?? '')
  const [fromId, setFromId] = useState(initialFrom ?? '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [weeks, setWeeks] = useState(52)
  const [include, setInclude] = useState({ lessons: true, assignments: true, subjects: true })
  const [preview, setPreview] = useState<CopyResult | null>(null)
  const [done, setDone] = useState<CopyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (!toId && targets.length === 1) setToId(targets[0].id) }, [targets, toId])
  // Usual source: last year's class in the same year of the programme (the
  // most recently archived one) — not the class this one continued from,
  // which followed the year before's plan
  useEffect(() => {
    const target = cohortOf(toId)
    if (fromId || !target) return
    const src = lastYearsClass(all, target)
    if (src) setFromId(src.id)
  }, [toId, fromId, cohortOf, all])
  // Period: the whole source class; shift: from its start to the target's
  useEffect(() => {
    const src = cohortOf(fromId), dst = cohortOf(toId)
    if (src) { setFrom(src.semesterStartDate ?? tsIso(src.startDate)); setTo(src.semesterSem2EndDate ?? src.semesterEndDate ?? tsIso(src.endDate)) }
    setWeeks(defaultShiftWeeks(src?.semesterStartDate ?? tsIso(src?.startDate), dst?.semesterStartDate ?? tsIso(dst?.startDate)))
  }, [fromId, toId, cohortOf])
  useEffect(() => { setPreview(null); setDone(null) }, [fromId, toId, from, to, weeks, include])

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(dryRun: boolean) {
    setBusy(true); setError('')
    try {
      const { data } = await copyPlan({ fromCohortId: fromId, toCohortId: toId, from, to, shiftDays: weeks * 7, ...include, dryRun })
      if (dryRun) setPreview(data); else setDone(data)
    } catch (e: any) {
      setError(e?.message ?? 'Copy failed.')
    } finally {
      setBusy(false)
    }
  }

  const ready = fromId && toId && from && to && from <= to && weeks > 0 && (include.lessons || include.assignments || include.subjects)
  const nothing = preview && preview.lessons.toCopy + preview.assignments.toCopy + preview.subjects === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="copy-plan-title" tabIndex={-1}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-5 space-y-4 outline-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="copy-plan-title" className="text-base font-semibold text-zinc-100">Copy last year's plan</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Lessons and assignments from another class, moved forward by whole weeks so each lesson keeps its weekday
              and time. Assignments arrive unpublished so you can check them first.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="cp-from" className="label text-xs">Copy from</label>
            <select id="cp-from" className="input text-sm" value={fromId} onChange={e => setFromId(e.target.value)}>
              <option value="" disabled>Choose a class…</option>
              {all.filter(c => c.id !== toId).map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cp-to" className="label text-xs">Into</label>
            <select id="cp-to" className="input text-sm" value={toId} onChange={e => setToId(e.target.value)}>
              <option value="" disabled>Choose a class…</option>
              {targets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {targets.length === 0 && <p className="text-xs text-zinc-500 mt-1">You're not a teacher in any current class yet.</p>}
          </div>
          <div>
            <label htmlFor="cp-start" className="label text-xs">Lessons from</label>
            <input id="cp-start" type="date" className="input text-sm" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cp-end" className="label text-xs">to (including)</label>
            <input id="cp-end" type="date" className="input text-sm" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="cp-weeks" className="label text-xs">Move dates forward by (weeks)</label>
            <input id="cp-weeks" type="number" min={1} max={156} className="input text-sm w-28" value={weeks}
              onChange={e => setWeeks(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
            <p className="text-[11px] text-zinc-500 mt-1">
              Worked out from when the two classes start. 52 weeks is the same weekday one year later.
            </p>
          </div>
        </div>

        <fieldset className="flex flex-wrap gap-4 text-sm text-zinc-300">
          <legend className="sr-only">What to copy</legend>
          {([['lessons', 'Lessons'], ['assignments', 'Assignments'], ['subjects', 'Subjects']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={include[k]} onChange={e => setInclude(v => ({ ...v, [k]: e.target.checked }))} /> {label}
            </label>
          ))}
        </fieldset>

        {!preview && !done && (
          <button onClick={() => run(true)} disabled={!ready || busy} className="btn-primary py-2 w-full justify-center disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Preview
          </button>
        )}

        {preview && !done && (
          <div className="space-y-3" aria-live="polite">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-zinc-300 space-y-1.5">
              <ul className="text-xs text-zinc-300 space-y-0.5">
                {include.lessons && <li>{n(preview.lessons.toCopy, 'lesson', 'lessons')} to copy{preview.lessons.alreadyCopied > 0 && ` (${preview.lessons.alreadyCopied} copied before, skipped)`}</li>}
                {include.assignments && <li>{n(preview.assignments.toCopy, 'assignment', 'assignments')}, unpublished{preview.assignments.alreadyCopied > 0 && ` (${preview.assignments.alreadyCopied} copied before, skipped)`}</li>}
                {include.subjects && <li>{n(preview.subjects, 'subject', 'subjects')} made visible to the class</li>}
              </ul>
              {preview.sample.length > 0 && (
                <div className="text-[11px] text-zinc-500 border-t border-white/10 pt-1.5 space-y-0.5">
                  <p>For example:</p>
                  {preview.sample.map(s => <p key={s.from + s.title}>{s.title}: {when(s.from)} → <span className="text-zinc-300">{when(s.to)}</span></p>)}
                </div>
              )}
            </div>
            <p className="text-[11px] text-zinc-500">Holidays and school breaks aren't moved — check the weeks around them afterwards.</p>
            <button onClick={() => run(false)} disabled={busy || !!nothing} className="btn-primary py-2 w-full justify-center disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />} {nothing ? 'Nothing to copy' : 'Copy'}
            </button>
          </div>
        )}

        {done && (
          <p className="text-sm text-emerald-300 flex items-center gap-2" aria-live="polite">
            <Check className="w-4 h-4" aria-hidden="true" />
            Copied {n(done.lessons.toCopy, 'lesson', 'lessons')}, {n(done.assignments.toCopy, 'assignment', 'assignments')} and {n(done.subjects, 'subject', 'subjects')} into {cohortOf(toId)?.name}.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  )
}
