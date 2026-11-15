import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { AlertTriangle, Gauge, Lock, RefreshCw } from 'lucide-react'
import { functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { LEGAL } from '@/config/legal'
import { BLOCK_PCT, LIMIT_MODULE, PLAN_FEATURES, MODULE_NAMES, planFor, type LimitKind, type PlanFeature } from '@/config/pricing'
import { useModuleGate } from '@/hooks/useModules'
import { usePlan, type LimitInfo } from '@/hooks/usePlan'
import { cn } from '@/lib/utils'

// Plan limits and plan features for school admins (functions/src/pricing.ts):
// a quiet note from 90% of a limit, a banner from 100%, and new items blocked
// from 110%. Nothing is ever removed. Students and teachers never see these.

const CONTACT_URL = `https://${LEGAL.appDomain}/contact`
const NOUN: Record<LimitKind, string> = { assets: 'assets', students: 'students' }

function Upgrade({ info }: { info: LimitInfo }) {
  const what = info.next
    ? <>Upgrade to {MODULE_NAMES[LIMIT_MODULE[info.kind]]} {info.next.name} ({info.next.limits.split(',')[0].toLowerCase()})</>
    : <>Ask about a larger limit</>
  return <>{what}: <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">contact CineForge</a>.</>
}

/** The note or banner for one limit, where items of that kind are added; nothing under 90% */
export function LimitNotice({ info, className }: { info: LimitInfo; className?: string }) {
  const { role } = useAuth()
  if (info.limit == null || info.state === 'ok') return null
  const noun = NOUN[info.kind]
  const numbers = `${info.used} of ${info.limit} ${noun}`
  // Teachers only hear about it when it stops them
  if (role !== 'admin') {
    return info.state === 'blocked'
      ? <p role="status" className={cn('text-sm text-rose-300', className)}>The school's plan limit is reached: new {noun} can't be added. Ask a school admin.</p>
      : null
  }
  if (info.state === 'warn') {
    return <p className={cn('text-xs text-amber-300/90', className)}>{numbers} used on {info.planLabel}. <Upgrade info={info} /></p>
  }
  const blocked = info.state === 'blocked'
  return (
    <div role="status" className={cn('rounded-xl border px-3 py-2 text-sm flex gap-2',
      blocked ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200', className)}>
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <p>
        {blocked
          ? <>Your plan's limit is reached ({numbers}): new {noun} can't be added. Nothing is removed. </>
          : <>You're over your plan's limit ({numbers}). New {noun} are blocked from {BLOCK_PCT}%. </>}
        <Upgrade info={info} />
      </p>
    </div>
  )
}

/** Usage against the plan's limits, for the admin dashboard (schools with a plan only) */
export function PlanUsage() {
  const plan = usePlan()
  const rental = useModuleGate('rental_inventory')
  const academy = useModuleGate('academy')
  const [counting, setCounting] = useState(false)
  const [error, setError] = useState('')
  if (!plan.hasPlan) return null
  const rows = [rental && plan.limit('assets'), academy && plan.limit('students')].filter(Boolean) as LimitInfo[]
  if (!rows.length) return null

  async function recount() {
    setCounting(true); setError('')
    try { await httpsCallable(functions, 'recountUsage')() }
    catch (e: any) { setError(e?.message ?? 'Could not count') }
    finally { setCounting(false) }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900 p-4 space-y-3" aria-label="Plan usage">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2"><Gauge className="w-4 h-4 text-zinc-500" /> Plan usage</h2>
        <button onClick={recount} disabled={counting} className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 disabled:opacity-50">
          <RefreshCw className={cn('w-3 h-3', counting && 'animate-spin')} /> Count again
        </button>
      </div>
      {rows.map(info => {
        const pct = info.limit ? Math.min(100, Math.round(info.used / info.limit * 100)) : 0
        return (
          <div key={info.kind} className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-300 capitalize">{NOUN[info.kind]} <span className="text-zinc-500 normal-case">· {info.planLabel}</span></span>
              <span className="text-zinc-400 tabular-nums">{info.limit == null ? `${info.used} · unlimited` : `${info.used} of ${info.limit}`}</span>
            </div>
            {info.limit != null && (
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden" role="progressbar" aria-label={`${NOUN[info.kind]} used`}
                aria-valuemin={0} aria-valuemax={info.limit} aria-valuenow={info.used}>
                <div className={cn('h-full rounded-full', info.state === 'ok' ? 'bg-brand-500' : info.state === 'warn' ? 'bg-amber-400' : 'bg-rose-500')}
                  style={{ width: `${pct}%` }} />
              </div>
            )}
            <LimitNotice info={info} />
          </div>
        )
      })}
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
    </section>
  )
}

/** In place of a feature the school's plan doesn't include */
export function PlanFeatureNote({ feature, className }: { feature: PlanFeature; className?: string }) {
  const f = PLAN_FEATURES[feature]
  return (
    <div className={cn('rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-300 flex gap-2', className)}>
      <Lock className="w-4 h-4 mt-0.5 shrink-0 text-zinc-500" aria-hidden="true" />
      <p>
        {f.label}: included in {MODULE_NAMES[f.module]} {planFor(f.module, f.plan)?.name} and up.
        {' '}<a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Contact CineForge</a> to upgrade.
      </p>
    </div>
  )
}

/** A friendlier error when a create was refused, possibly by the plan's limit */
export function limitError(e: any, kind: LimitKind): string {
  if (String(e?.code).endsWith('resource-exhausted')) return e.message
  if (e?.code === 'permission-denied') return `Not saved: the plan's ${NOUN[kind]} limit may be reached (see the plan note on this page).`
  return e?.message ?? 'Unknown error'
}
