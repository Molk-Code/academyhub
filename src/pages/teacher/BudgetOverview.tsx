import { cn } from '@/lib/utils'
import type {
  ProductionPeriodDoc, ProductionDoc, ProductionShootingDayDoc,
  ProductionCrewAssignmentDoc, CrewRoleDoc, EquipmentBookingDoc, EquipmentDoc,
} from '@/types'
import { salaryCost as calcSalaryCost, equipmentCostForProduction } from '@/lib/productionBudget'

export function BudgetOverview({ period, productions, prodDayData, crewRoles, equipmentBookings, equipmentById }: {
  period: ProductionPeriodDoc
  productions: ProductionDoc[]
  prodDayData: Record<string, { days: ProductionShootingDayDoc[]; crewAssignments: ProductionCrewAssignmentDoc[] }>
  crewRoles: CrewRoleDoc[]
  equipmentBookings: EquipmentBookingDoc[]
  equipmentById: Record<string, EquipmentDoc>
}) {
  const currency = period.budgetCurrency || 'SEK'
  const limit    = period.budgetPerProduction ?? null
  const fmt = (n: number) => n.toLocaleString('sv-SE')

  return (
    <div className="space-y-4">
      {limit != null && (
        <div className="flex items-center gap-3 bg-brand-900/20 border border-brand-500/20 rounded-xl px-4 py-3 text-sm">
          <span className="text-brand-400 font-semibold">Budget per production:</span>
          <span className="text-zinc-200 font-bold">{fmt(limit)} {currency}</span>
          {period.budgetNotes && <span className="text-zinc-500 ml-2">— {period.budgetNotes}</span>}
        </div>
      )}
      {productions.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">No productions linked to this period yet.</p>
      )}
      {productions.length > 0 && (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Production</th>
                {limit != null && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">Budget used</th>
                )}
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {productions.map(prod => {
                const prodLimit = prod.budgetLimit ?? limit
                const data      = prodDayData[prod.id]
                const salary    = data ? calcSalaryCost(data.crewAssignments, crewRoles, data.days.length) : 0
                const equipCost = equipmentCostForProduction(prod.id, equipmentBookings, equipmentById)
                const used      = salary + equipCost
                const over      = prodLimit != null && used > prodLimit
                return (
                  <tr key={prod.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3 text-zinc-200 font-medium">{prod.title}</td>
                    {limit != null && (
                      <td className="px-4 py-3 text-right">
                        {prodLimit != null ? (
                          <span className={cn('font-semibold', over ? 'text-rose-400' : 'text-emerald-400')}>
                            {fmt(used)} / {fmt(prodLimit)} {currency}
                          </span>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        prod.productionType === 'side' ? 'bg-amber-900/30 text-amber-400' : 'bg-brand-900/30 text-brand-400',
                      )}>
                        {prod.productionType === 'side' ? 'Side project' : 'Period'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
