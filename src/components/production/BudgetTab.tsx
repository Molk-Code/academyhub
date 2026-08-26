import { useState, useEffect, useMemo } from 'react'
import { getDocs, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { useSchool } from '@/contexts/SchoolContext'
import type { ProductionCrewAssignmentDoc, ProductionShootingDayDoc, CrewRoleDoc } from '@/types'

interface BudgetTabProps {
  productionId: string
  crewAssignments: ProductionCrewAssignmentDoc[]
  shootingDays: ProductionShootingDayDoc[]
  budgetLimit?: number
  budgetCurrency?: string
  productionType?: 'period' | 'side'
  canEdit?: boolean
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export function BudgetTab({
  productionId: _productionId,
  crewAssignments,
  shootingDays,
  budgetLimit,
  budgetCurrency,
}: BudgetTabProps) {
  const { currency: schoolCurrency } = useSchool()
  const activeCurrency = budgetCurrency || schoolCurrency
  const [crewRoles, setCrewRoles] = useState<CrewRoleDoc[]>([])

  useEffect(() => {
    getDocs(collection(db, 'crew_roles')).then(snap =>
      setCrewRoles(snap.docs.map(d => ({ id: d.id, ...d.data() } as CrewRoleDoc)))
    )
  }, [])

  const shootingDayCount = shootingDays.length

  const rows = useMemo(() => {
    return crewAssignments
      .filter(a => a.assignedName?.trim())
      .map(a => {
        const role    = crewRoles.find(r => r.id === a.roleId)
        const dayRate = role?.dayRate ?? 0
        const total   = dayRate * shootingDayCount
        return { assignment: a, role, dayRate, total }
      })
  }, [crewAssignments, crewRoles, shootingDayCount])

  /* Rate overrides intentionally not available here — edit rates in Admin → Production Settings */

  const salaryCost    = useMemo(() => rows.reduce((sum, r) => sum + r.total, 0), [rows])
  const equipmentLeft = budgetLimit != null ? budgetLimit - salaryCost : null
  const overSalary    = budgetLimit != null && salaryCost > budgetLimit

  const fmt = (n: number) => n.toLocaleString('sv-SE')

  return (
    <div className="space-y-5">

      {/* ── Budget summary cards ──────────────────────────────────────── */}
      {budgetLimit != null ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Total budget */}
          <div className="bg-zinc-900 border border-white/10 rounded-xl p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total budget</p>
            <p className="text-xl font-bold text-zinc-100">{fmt(budgetLimit)} <span className="text-sm font-normal text-zinc-500">{activeCurrency}</span></p>
          </div>
          {/* Salary cost */}
          <div className={cn('rounded-xl p-4 border', overSalary ? 'bg-rose-900/20 border-rose-500/30' : 'bg-zinc-900 border-white/10')}>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Salaries</p>
            <p className={cn('text-xl font-bold', overSalary ? 'text-rose-400' : 'text-zinc-100')}>
              {fmt(salaryCost)} <span className="text-sm font-normal text-zinc-500">{activeCurrency}</span>
            </p>
            <p className={cn('text-xs mt-0.5', overSalary ? 'text-rose-500' : 'text-zinc-600')}>
              {shootingDayCount} shooting {shootingDayCount === 1 ? 'day' : 'days'} · {fmt(salaryCost)} / {fmt(budgetLimit)}
            </p>
            <ProgressBar value={salaryCost} max={budgetLimit} color={overSalary ? '#f87171' : '#60a5fa'} />
          </div>
          {/* Equipment remaining */}
          <div className={cn('rounded-xl p-4 border', (equipmentLeft ?? 0) < 0 ? 'bg-rose-900/20 border-rose-500/30' : 'bg-emerald-900/20 border-emerald-500/30')}>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Equipment budget</p>
            <p className={cn('text-xl font-bold', (equipmentLeft ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400')}>
              {fmt(Math.max(0, equipmentLeft ?? 0))} <span className="text-sm font-normal text-zinc-500">{activeCurrency}</span>
            </p>
            <p className="text-xs text-zinc-600 mt-0.5">Remaining after salaries</p>
            <ProgressBar value={Math.max(0, equipmentLeft ?? 0)} max={budgetLimit} color={(equipmentLeft ?? 0) < 0 ? '#f87171' : '#34d399'} />
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-400">
          No budget limit set for this production. Set one via the production period settings.
        </div>
      )}

      {/* ── Salary breakdown table ────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="text-center py-10 text-zinc-500 text-sm">
          <p className="text-3xl mb-2">👥</p>
          <p>No crew assigned yet. Add crew members in the Crew tab to see the salary breakdown.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Crew member</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">Rate / day</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">Days</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map(({ assignment: a, dayRate, total }) => (
                <tr key={a.roleId} className="hover:bg-white/3 transition-colors">
                  <td className="px-4 py-3 text-zinc-200 font-medium">{a.assignedName}</td>
                  <td className="px-4 py-3 text-zinc-400">{a.roleName}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-zinc-300">{dayRate.toLocaleString('sv-SE')} {activeCurrency}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-400">{shootingDayCount}</td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-200">
                    {total.toLocaleString('sv-SE')} {activeCurrency}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 bg-zinc-950/40">
                <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-zinc-300">Total salaries</td>
                <td className={cn('px-4 py-3 text-right font-bold', overSalary ? 'text-rose-400' : 'text-zinc-100')}>
                  {fmt(salaryCost)} {activeCurrency}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-zinc-500 text-center">
          Day rates are managed by your admin in Admin → Production Settings.
        </p>
      )}
    </div>
  )
}
