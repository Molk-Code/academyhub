import { useState } from 'react'
import { doc, setDoc, limit, orderBy, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useCollection, useDocument } from '@/hooks/useFirestore'
import { Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Timestamp } from 'firebase/firestore'

// How long the school keeps former students' data. The school is the data
// controller, so this is its choice; off until an admin sets it. The nightly
// job (functions/src/retention.ts) erases students still in a class archived
// longer ago than this, exactly as if they had deleted their own account.

interface RetentionDoc { id: string; archivedClassMonths?: number | null }
interface JobsDoc { id: string; dryRun?: Record<string, boolean> }
interface RunDoc { id: string; at?: Timestamp; dryRun: boolean; months: number; due: number; erased: number; failed: number; classes?: string[]; names?: string[] }

const preview = httpsCallable<void, { enabled: boolean; months: number | null; due: { displayName: string; cohortName: string }[] }>(functions, 'previewRetention')
const OPTIONS = [6, 12, 18, 24, 36]

export default function RetentionSettings() {
  const { data: settings } = useDocument<RetentionDoc>('settings', 'retention')
  const { data: jobs } = useDocument<JobsDoc>('settings', 'jobs')
  const { data: runs } = useCollection<RunDoc>('job_runs', [where('job', '==', 'retention'), orderBy('at', 'desc'), limit(5)])
  const [checking, setChecking] = useState(false)
  const [due, setDue] = useState<{ displayName: string; cohortName: string }[] | null>(null)
  const [error, setError] = useState('')

  const months = settings?.archivedClassMonths ?? null
  const dryRun = jobs?.dryRun?.retention === true

  async function setMonths(value: number | null) {
    setDue(null)
    if (value !== null && months === null && !dryRun) {
      // Turning it on: start with a test run so nobody is deleted before the admin has seen the list
      await setDoc(doc(db, 'settings', 'jobs'), { dryRun: { retention: true } }, { merge: true })
    }
    await setDoc(doc(db, 'settings', 'retention'), { archivedClassMonths: value }, { merge: true })
  }

  async function setDryRun(on: boolean) {
    if (!on && !confirm('Turn off the test run? From tonight, former students in the list are permanently deleted. This cannot be undone.')) return
    await setDoc(doc(db, 'settings', 'jobs'), { dryRun: { retention: on } }, { merge: true })
  }

  async function check() {
    setChecking(true); setError('')
    try { setDue((await preview()).data.due) }
    catch (e: any) { setError(e?.message ?? 'Could not check') }
    finally { setChecking(false) }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900 p-5 space-y-4" aria-labelledby="retention-title">
      <div>
        <h2 id="retention-title" className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-brand-400" aria-hidden="true" /> Delete former students' data
        </h2>
        <p className="text-xs text-zinc-500 mt-1">
          Your school decides how long it keeps the data of students who have left. Students still in an archived
          class are deleted this long after the class was archived: their account, attendance details, submissions,
          bookings, plans and messages, just as when someone deletes their own account. Students who moved on to a
          new class, and staff, are never affected.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="retention-months" className="label text-xs">Delete after</label>
          <select id="retention-months" className="input text-sm w-auto" value={months ?? ''}
            onChange={e => setMonths(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Never (off)</option>
            {OPTIONS.map(m => <option key={m} value={m}>{m} months after the class ended</option>)}
          </select>
        </div>
        {months !== null && (
          <label className="flex items-center gap-2 text-sm text-zinc-300 pb-2">
            <button type="button" role="switch" aria-checked={dryRun} onClick={() => setDryRun(!dryRun)}
              className={cn('relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors', dryRun ? 'bg-brand-600' : 'bg-zinc-700')}>
              <span className={cn('inline-block h-4 w-4 rounded-full bg-zinc-900 transition-transform', dryRun ? 'translate-x-6' : 'translate-x-1')} />
            </button>
            Test run (list who would be deleted, delete nobody)
          </label>
        )}
      </div>

      {months !== null && (
        <p className={cn('text-xs', dryRun ? 'text-zinc-400' : 'text-amber-300')}>
          {dryRun
            ? 'Test run: each night the list of who would be deleted is saved below. Nobody is deleted.'
            : `On: each night, students in classes archived more than ${months} months ago are permanently deleted.`}
        </p>
      )}

      {months !== null && (
        <div className="space-y-2">
          <button type="button" onClick={check} disabled={checking} className="btn-secondary py-1.5 text-xs">
            {checking && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Check who would be deleted now
          </button>
          {due && (
            <div className="text-xs text-zinc-400" aria-live="polite">
              {due.length === 0 ? 'Nobody at the moment.' : (
                <>
                  <p>{due.length} {due.length === 1 ? 'student' : 'students'}:</p>
                  <ul className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
                    {due.map((d, i) => <li key={i}>{d.displayName || '(no name)'} · {d.cohortName}</li>)}
                  </ul>
                </>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
        </div>
      )}

      {runs.length > 0 && (
        <div className="border-t border-white/5 pt-3">
          <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Latest runs</p>
          <ul className="text-xs text-zinc-400 space-y-1">
            {runs.map(r => (
              <li key={r.id}>
                {r.at?.toDate().toLocaleString('sv-SE')} · {r.dryRun ? `test run: would delete ${r.due}` : `deleted ${r.erased}${r.failed ? `, ${r.failed} failed` : ''}`}
                {r.classes?.length ? ` (${r.classes.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
