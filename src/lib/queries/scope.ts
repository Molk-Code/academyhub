// The scoping rules behind the query hooks, as plain functions (unit-tested
// in queries.test.ts without Firebase).
import type { UserDoc } from '@/types'

// Which class a student-route screen shows. One rule for every page: an admin
// previewing a class sees that class, even when their own profile has a
// cohortId; everyone else sees their own class. Before this lived in each page
// in two different orders, so an admin with a cohortId saw the previewed class
// on Subjects but their own class on the Calendar and Dashboard.
//
// Only for screens under the student layout: the teacher layout doesn't clear
// a preview, so shared screens (equipment booking, teacher pages) keep using
// the signed-in user's own class.
export function resolveViewCohortId(
  previewCohortId: string | null | undefined,
  cohortId: string | null | undefined,
  profileCohortId?: string | null,
): string | null {
  return previewCohortId || cohortId || profileCohortId || null
}

// Calendar class toggles (teacher calendar): a class that is switched off hides
// its lessons and Outlook events. Events for every class ('all') or without a
// class always show, and a class missing from the toggles counts as on.
export function cohortToggleAllows(
  cohortId: string | null | undefined,
  active: Record<string, boolean>,
): boolean {
  if (!cohortId || cohortId === 'all') return true
  return active[cohortId] !== false
}

// Which Outlook (synced_events) events a viewer may see. The rules let a
// student read only their own class and 'all', so the query has to say so.
export type SyncedEventScope =
  | { kind: 'every-class' }                 // staff, not previewing
  | { kind: 'class'; cohortId: string }     // the class + events for every class
  | { kind: 'shared-only' }                 // no class: only events for every class
  | { kind: 'none' }

export function syncedEventScope(opts: {
  cohortId: string | null | undefined
  everyClass?: boolean
  requireCohort?: boolean
}): SyncedEventScope {
  if (opts.everyClass) return { kind: 'every-class' }
  if (opts.cohortId) return { kind: 'class', cohortId: opts.cohortId }
  return opts.requireCohort ? { kind: 'none' } : { kind: 'shared-only' }
}

// One person can have more than one users doc (an old account and the one
// they sign in with now). Pickers show them once, by name, and send invites to
// every id so the person sees it whichever account they use.
export interface UserGroup {
  repId: string
  allIds: string[]
  displayName: string
  roles: string[]
}

export function groupUsersByName(
  users: UserDoc[],
  opts: { excludeUid?: string | null; roles: string[] },
): UserGroup[] {
  const groups: UserGroup[] = []
  const byName = new Map<string, UserGroup>()
  for (const u of users) {
    if (opts.excludeUid && (u.id === opts.excludeUid || u.uid === opts.excludeUid)) continue
    if (u.isActive === false) continue
    const allRoles = u.roles ?? [u.role]
    if (!allRoles.some(r => opts.roles.includes(r))) continue
    const name = u.displayName?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const existing = byName.get(key)
    if (existing) {
      if (!existing.allIds.includes(u.id)) existing.allIds.push(u.id)
    } else {
      const g: UserGroup = { repId: u.id, allIds: [u.id], displayName: name, roles: allRoles }
      groups.push(g)
      byName.set(key, g)
    }
  }
  return groups
}

export function filterGroups(groups: UserGroup[], search: string): UserGroup[] {
  const q = search.trim().toLowerCase()
  return q ? groups.filter(g => g.displayName.toLowerCase().includes(q)) : groups
}


// Classes: archived ones (ended, see class rollover) stay readable for history
// but are never offered for new work
export const isArchivedCohort = (c: { archived?: boolean }) => c.archived === true

export function sortCohorts<T extends { name: string; archived?: boolean }>(cohorts: T[]): { active: T[]; all: T[] } {
  const all = [...cohorts].sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  return { active: all.filter(c => !isArchivedCohort(c)), all }
}
