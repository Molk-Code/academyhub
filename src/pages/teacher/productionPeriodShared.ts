import type { ProductionDoc, PeriodAllocationDoc } from '@/types'

// Shared helpers (duplicated from the student production-period page to
// keep the two pages independent — see that file for the student version).

export const PROD_COLORS = [
  '#3b82f6','#ef4444','#22c55e','#f97316',
  '#8b5cf6','#ec4899','#06b6d4','#eab308',
  '#10b981','#6366f1','#f43f5e','#84cc16',
]

export function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  if (!s1 || !e1 || !s2 || !e2) return true
  return s1 < e2 && s2 < e1
}

export function buildColorMap(productions: ProductionDoc[]): Record<string, string> {
  const sorted = [...productions].sort((a, b) => a.id.localeCompare(b.id))
  return Object.fromEntries(sorted.map((p, i) => [p.id, PROD_COLORS[i % PROD_COLORS.length]]))
}

export function buildConflicts(allocations: PeriodAllocationDoc[]): Set<string> {
  const byDate: Record<string, PeriodAllocationDoc[]> = {}
  for (const a of allocations) {
    if (!byDate[a.date]) byDate[a.date] = []
    byDate[a.date].push(a)
  }
  const conflictDates = new Set<string>()
  for (const [, dayAllocs] of Object.entries(byDate)) {
    for (let i = 0; i < dayAllocs.length; i++) {
      for (let j = i + 1; j < dayAllocs.length; j++) {
        const a = dayAllocs[i], b = dayAllocs[j]
        if (!timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue
        if (a.location && b.location && a.location.trim().toLowerCase() === b.location.trim().toLowerCase())
          conflictDates.add(a.date)
        if (a.crewNeeded.some(uid => b.crewNeeded.includes(uid)))
          conflictDates.add(a.date)
      }
    }
  }
  return conflictDates
}
