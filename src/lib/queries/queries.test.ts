import { describe, expect, it } from 'vitest'
import type { UserDoc } from '@/types'
import { resolveViewCohortId, cohortToggleAllows, syncedEventScope, groupUsersByName, filterGroups, sortCohorts } from './scope'

describe('resolveViewCohortId', () => {
  it('an admin previewing a class sees that class, even with a class of their own', () => {
    expect(resolveViewCohortId('film2', 'film1', 'film1')).toBe('film2')
  })
  it('otherwise the signed-in class, then the profile', () => {
    expect(resolveViewCohortId(null, 'film1', 'old')).toBe('film1')
    expect(resolveViewCohortId(null, null, 'film1')).toBe('film1')
    expect(resolveViewCohortId(undefined, undefined)).toBeNull()
  })
})

describe('cohortToggleAllows', () => {
  const active = { film1: true, film2: false }
  it('hides a class that is switched off', () => {
    expect(cohortToggleAllows('film2', active)).toBe(false)
    expect(cohortToggleAllows('film1', active)).toBe(true)
  })
  it('always shows events for every class or without a class, and unknown classes', () => {
    expect(cohortToggleAllows('all', active)).toBe(true)
    expect(cohortToggleAllows(undefined, active)).toBe(true)
    expect(cohortToggleAllows('film3', active)).toBe(true)
  })
})

describe('syncedEventScope', () => {
  it('staff outside preview see every class', () => {
    expect(syncedEventScope({ cohortId: 'film1', everyClass: true })).toEqual({ kind: 'every-class' })
  })
  it('a class sees its own and shared events', () => {
    expect(syncedEventScope({ cohortId: 'film1' })).toEqual({ kind: 'class', cohortId: 'film1' })
  })
  it('without a class: shared events only, or nothing when a class is required', () => {
    expect(syncedEventScope({ cohortId: null })).toEqual({ kind: 'shared-only' })
    expect(syncedEventScope({ cohortId: null, requireCohort: true })).toEqual({ kind: 'none' })
  })
})

describe('groupUsersByName', () => {
  const u = (id: string, displayName: string, extra: Partial<UserDoc> = {}) =>
    ({ id, uid: id, displayName, role: 'student', ...extra }) as UserDoc
  const users = [
    u('a1', 'Alva Berg'),
    u('a2', ' alva berg '),                       // duplicate doc, other casing and spacing
    u('me', 'Me Myself', { role: 'teacher' }),
    u('t1', 'Tove Lind', { role: 'admin', roles: ['admin', 'teacher'] }),
    u('x1', 'Gone', { isActive: false }),
    u('ad', 'Only Admin', { role: 'admin' }),
    u('nn', ''),
  ]

  it('one entry per person, every id kept, the first doc as representative', () => {
    const groups = groupUsersByName(users, { excludeUid: 'me', roles: ['student', 'teacher'] })
    expect(groups.map(g => g.displayName)).toEqual(['Alva Berg', 'Tove Lind'])
    expect(groups[0]).toMatchObject({ repId: 'a1', allIds: ['a1', 'a2'] })
  })

  it('search ignores case and surrounding spaces', () => {
    const groups = groupUsersByName(users, { roles: ['student', 'teacher'] })
    expect(filterGroups(groups, '  TOVE ').map(g => g.repId)).toEqual(['t1'])
    expect(filterGroups(groups, '')).toHaveLength(groups.length)
  })
})

describe('sortCohorts', () => {
  it('by name; archived classes only in `all`', () => {
    const r = sortCohorts([{ name: 'Ö-klass' }, { name: 'Film 2025', archived: true }, { name: 'Ljud' }, { name: 'Film 2026' }])
    expect(r.active.map(c => c.name)).toEqual(['Film 2026', 'Ljud', 'Ö-klass'])
    expect(r.all.map(c => c.name)).toEqual(['Film 2025', 'Film 2026', 'Ljud', 'Ö-klass'])
  })
})

// Pages must use this layer rather than rebuild its rules. A match here means
// a page went back to its own copy: use the hook from '@/lib/queries' instead.
describe('pages use the query layer', () => {
  const pages = import.meta.glob('/src/pages/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

  // Shared with the teacher layout, which doesn't clear a preview: keeps the user's own class first
  const OWN_CLASS_FIRST = new Set(['/src/pages/equipment/EquipmentBookingPage.tsx'])

  const offenders = (re: RegExp, skip = new Set<string>()) =>
    Object.entries(pages).filter(([path, src]) => !skip.has(path) && re.test(src)).map(([path]) => path)

  it('found the pages', () => {
    expect(Object.keys(pages).length).toBeGreaterThan(50)
  })
  it('which class to show: useViewCohortId', () => {
    expect(offenders(/previewCohortId \?\?|\?\? previewCohortId/, OWN_CLASS_FIRST)).toEqual([])
  })
  it('Outlook events: useVisibleEvents', () => {
    expect(offenders(/useCollection<SyncedEventDoc>|useCollection\(\s*'synced_events'/)).toEqual([])
  })
  it('class lists: useCohorts (keeps archived classes out of pickers)', () => {
    expect(offenders(/useCollection<CohortDoc>\('cohorts'\s*[,)]/)).toEqual([])
  })
  it('duplicate users: groupUsersByName / useInvitableUserGroups', () => {
    expect(offenders(/repId: u\.id/)).toEqual([])
  })
})
