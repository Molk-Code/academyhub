import { useMemo } from 'react'
import type { PeriodAllocationDoc, UserDoc, ProductionDoc } from '@/types'
import { format, parseISO } from 'date-fns'
import { buildColorMap } from './productionPeriodShared'

export function CrewView({ allocations, students, productions }: {
  allocations: PeriodAllocationDoc[]
  students: UserDoc[]
  productions: ProductionDoc[]
}) {
  const colorMap = useMemo(() => buildColorMap(productions), [productions])

  const byStudent = useMemo(() => {
    const m: Record<string, PeriodAllocationDoc[]> = {}
    for (const s of students) m[s.uid] = []
    for (const a of allocations)
      for (const uid of a.crewNeeded)
        if (m[uid]) m[uid].push(a)
    return m
  }, [allocations, students])

  return (
    <div className="space-y-3">
      {students.length === 0 && <p className="text-zinc-500 text-sm text-center py-8">No students in this cohort.</p>}
      {students.map(s => {
        const days = byStudent[s.uid] ?? []
        return (
          <div key={s.uid} className="bg-zinc-900 border border-white/10 rounded-xl p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-100">{s.displayName}</p>
              <p className="text-xs text-zinc-500">{days.length} shooting day{days.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex flex-wrap gap-1 justify-end">
              {days.sort((a, b) => a.date.localeCompare(b.date)).map(a => (
                <span key={a.id}
                  className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                  style={{ background: (colorMap[a.productionId] ?? '#6366f1') + '33', color: colorMap[a.productionId] ?? '#6366f1' }}
                >
                  {format(parseISO(a.date), 'd MMM')}
                </span>
              ))}
              {days.length === 0 && <span className="text-[10px] text-zinc-600">No days assigned</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
