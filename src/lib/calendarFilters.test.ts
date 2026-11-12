import { describe, expect, it } from 'vitest'
import { calendarCategory } from './calendarFilters'

// Event shapes as the student calendar (pages/student/Calendar.tsx) and the
// teacher calendar (pages/teacher/Lessons.tsx) build them
const ev = (extendedProps: Record<string, unknown>) => ({ id: 'x', title: 'x', extendedProps })

describe('calendarCategory', () => {
  it('student calendar', () => {
    expect(calendarCategory(ev({ type: 'lesson', subjectId: 's1' }))).toBe('lessons')
    expect(calendarCategory(ev({ type: 'assignment', dueDate: new Date() }))).toBe('deadlines')
    expect(calendarCategory(ev({ isSynced: true, docId: 'e1' }))).toBe('outlook')
    expect(calendarCategory(ev({ isPersonal: true, docId: 'p1' }))).toBe('mine')
    expect(calendarCategory(ev({ isPersonal: true, isInvited: true, docId: 'p2' }))).toBe('mine')
    expect(calendarCategory(ev({ isSemesterMarker: true }))).toBeNull()
  })

  it('teacher calendar', () => {
    expect(calendarCategory(ev({ isBlock: false, subjectId: 's1', cohortId: 'c1' }))).toBe('lessons')
    expect(calendarCategory(ev({ isBlock: true, blockDate: '2026-11-12' }))).toBe('lessons') // bookable slot
    expect(calendarCategory(ev({ isSynced: true, cohortId: 'c1' }))).toBe('outlook')
    expect(calendarCategory(ev({ isPersonal: true, isOwn: true, userId: 'me' }))).toBe('mine')
    expect(calendarCategory(ev({ isPersonal: true, isOwn: false, userId: 'colleague' }))).toBeNull() // own per-teacher toggle
    expect(calendarCategory(ev({ isSemesterMarker: true }))).toBeNull()
  })

  it('leaves unknown events visible rather than guessing', () => {
    expect(calendarCategory({ id: 'x', title: 'x' })).toBeNull()
  })
})
