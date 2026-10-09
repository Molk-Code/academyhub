import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { ProductionPeriodDoc, ProductionDoc, PeriodAllocationDoc, UserDoc } from '@/types'
import { AlertTriangle } from 'lucide-react'
import { eachDayOfInterval, format, isToday, parseISO } from 'date-fns'
import { buildColorMap, buildConflicts } from './productionPeriodShared'

export function MasterCalendar({ period, productions, allocations, students, onCellClick, onToggleWorkingDay }: {
  period: ProductionPeriodDoc
  productions: ProductionDoc[]
  allocations: PeriodAllocationDoc[]
  students: UserDoc[]
  onCellClick: (date: string, prod: ProductionDoc) => void
  onToggleWorkingDay: (date: string) => void
}) {
  const colorMap      = useMemo(() => buildColorMap(productions), [productions])
  const conflictDates = useMemo(() => buildConflicts(allocations), [allocations])

  const dates = useMemo(() => {
    if (!period.startDate || !period.endDate) return []
    try { return eachDayOfInterval({ start: parseISO(period.startDate), end: parseISO(period.endDate) }) }
    catch { return [] }
  }, [period.startDate, period.endDate])

  const allocMap = useMemo(() => {
    const m: Record<string, Record<string, PeriodAllocationDoc>> = {}
    for (const a of allocations) {
      if (!m[a.productionId]) m[a.productionId] = {}
      m[a.productionId][a.date] = a
    }
    return m
  }, [allocations])

  const COL_W = 'w-24 min-w-[6rem]'

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <div className="min-w-max">
        {/* Header */}
        <div className="flex bg-zinc-900 border-b border-white/10">
          <div className="w-44 min-w-[11rem] px-3 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider flex-shrink-0 sticky left-0 bg-zinc-900 z-10 border-r border-white/8">
            Production
          </div>
          {dates.map(date => {
            const ds   = format(date, 'yyyy-MM-dd')
            const wday = !period.workingDays.includes(ds)
            const today = isToday(date)
            return (
              <div key={ds}
                onClick={() => onToggleWorkingDay(ds)}
                title={wday ? 'Click to mark as working day' : 'Click to mark as non-shooting day'}
                className={cn(
                  COL_W, 'flex-shrink-0 px-1 py-2 text-center border-r border-white/5 last:border-r-0 cursor-pointer select-none transition-colors',
                  today ? 'bg-amber-900/30 hover:bg-amber-900/40' : wday ? 'bg-zinc-900/40 hover:bg-zinc-800/60' : 'bg-zinc-900 hover:bg-white/5',
                )}
              >
                <p className={cn('text-[10px] font-bold uppercase tracking-wide', today ? 'text-amber-400' : wday ? 'text-zinc-600' : 'text-zinc-400')}>
                  {format(date, 'EEE')}
                </p>
                <p className={cn('text-xs font-semibold', today ? 'text-amber-300' : wday ? 'text-zinc-600' : 'text-zinc-200')}>
                  {format(date, 'd MMM')}
                </p>
                {conflictDates.has(ds) && <span className="text-[9px] text-rose-400 font-bold">⚠</span>}
                {wday && <span className="text-[8px] text-zinc-600">—</span>}
              </div>
            )
          })}
        </div>

        {/* Production rows */}
        {productions.map(prod => {
          const color = colorMap[prod.id]
          return (
            <div key={prod.id} className="flex border-b border-white/5 last:border-b-0">
              <div className="w-44 min-w-[11rem] px-3 py-2.5 flex-shrink-0 sticky left-0 bg-zinc-950 z-10 border-r border-white/8 flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-xs text-zinc-200 truncate font-medium">{prod.title}</span>
              </div>
              {dates.map(date => {
                const ds    = format(date, 'yyyy-MM-dd')
                const wday  = !period.workingDays.includes(ds)
                const today = isToday(date)
                const alloc = allocMap[prod.id]?.[ds]
                return (
                  <div key={ds}
                    onClick={() => alloc && onCellClick(ds, prod)}
                    className={cn(
                      COL_W, 'flex-shrink-0 border-r border-white/5 last:border-r-0 min-h-[3rem] p-1 transition-colors',
                      wday ? 'bg-zinc-900/40' : today ? 'bg-amber-950/10' : '',
                      alloc ? 'cursor-pointer hover:bg-white/5' : '',
                    )}
                  >
                    {alloc ? (
                      <div
                        className="rounded-lg px-1.5 py-1 text-[10px] leading-tight h-full min-h-[2.5rem] flex flex-col justify-center"
                        style={{ background: color + '33', borderLeft: `2px solid ${color}` }}
                      >
                        <p className="font-semibold truncate" style={{ color }}>
                          {alloc.startTime && alloc.endTime ? `${alloc.startTime}–${alloc.endTime}` : '●'}
                        </p>
                        {alloc.location && (
                          <p className="truncate" style={{ color: color + 'bb' }}>{alloc.location}</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Conflicts row */}
        {conflictDates.size > 0 && (
          <div className="flex bg-zinc-950/50">
            <div className="w-44 min-w-[11rem] px-3 py-2 flex-shrink-0 sticky left-0 bg-zinc-950 z-10 border-r border-white/8 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
              <span className="text-[10px] text-rose-400 font-semibold uppercase tracking-wider">Conflicts</span>
            </div>
            {dates.map(date => {
              const ds = format(date, 'yyyy-MM-dd')
              return (
                <div key={ds} className={cn(COL_W, 'flex-shrink-0 border-r border-white/5 last:border-r-0 min-h-[2rem] flex items-center justify-center')}>
                  {conflictDates.has(ds) && <span className="text-[10px] font-bold text-rose-400 bg-rose-900/30 rounded px-1">⚠</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
