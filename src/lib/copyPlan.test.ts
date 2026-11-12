import { describe, expect, it } from 'vitest'
import type { CohortDoc } from '@/types'
import { lastYearsClass, defaultShiftWeeks } from './classRollover'

const c = (id: string, programYear: 1 | 2, archivedAt?: number) =>
  ({ id, name: id, programYear, archived: archivedAt != null, ...(archivedAt != null ? { archivedAt: { toMillis: () => archivedAt } } : {}) }) as unknown as CohortDoc

describe('lastYearsClass', () => {
  it('the most recently archived class in the same programme year', () => {
    const all = [c('old1', 1, 100), c('old2', 2, 100), c('older2', 2, 50), c('now2', 2), c('now1', 1)]
    expect(lastYearsClass(all, all[3])?.id).toBe('old2')
    expect(lastYearsClass(all, all[4])?.id).toBe('old1')
    expect(lastYearsClass([c('now1', 1)], c('now1', 1))).toBeUndefined()
  })
})

describe('defaultShiftWeeks', () => {
  it('whole weeks between the starts, else 52', () => {
    expect(defaultShiftWeeks('2025-08-18', '2026-08-17')).toBe(52)
    expect(defaultShiftWeeks('2025-08-18', '2026-08-24')).toBe(53)
    expect(defaultShiftWeeks(undefined, '2026-08-17')).toBe(52)
  })
})
