import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { CohortDoc } from '@/types'
import { plusOneYear, nextClassName, suggestNextClass, graduatesByDefault } from './classRollover'

describe('plusOneYear', () => {
  it('moves a date one year on', () => {
    expect(plusOneYear('2025-08-18')).toBe('2026-08-18')
    expect(plusOneYear('2028-02-29')).toBe('2029-02-28')
    expect(plusOneYear(undefined)).toBe('')
  })
})

describe('nextClassName', () => {
  it('moves the year in the name up', () => {
    expect(nextClassName('Film Åk 1')).toBe('Film Åk 2')
    expect(nextClassName('Year 1 Sound')).toBe('Year 2 Sound')
    expect(nextClassName('Film 2025')).toBe('Film 2025')
    expect(nextClassName('Åk 10')).toBe('Åk 10')
  })
})

describe('suggestNextClass', () => {
  it('same dates next year, year 2', () => {
    const c = {
      id: 'c', name: 'Film Åk 1', programYear: 1, teacherIds: [], studentIds: [],
      startDate: Timestamp.fromDate(new Date(2025, 7, 18)), endDate: Timestamp.fromDate(new Date(2026, 5, 12)),
      semesterStartDate: '2025-08-18',
    } as CohortDoc
    expect(suggestNextClass(c)).toMatchObject({
      name: 'Film Åk 2', startDate: '2026-08-18', endDate: '2027-06-12', programYear: 2,
      semesterStartDate: '2026-08-18', semesterEndDate: '',
    })
    expect(graduatesByDefault(c)).toBe(false)
    expect(graduatesByDefault({ programYear: 2 })).toBe(true)
  })
})
