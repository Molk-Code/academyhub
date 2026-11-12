import { useMemo } from 'react'
import { where, type QueryConstraint } from 'firebase/firestore'
import { useCollection } from '@/hooks/useFirestore'
import type { LessonDoc, SyncedEventDoc } from '@/types'
import { syncedEventScope, type SyncedEventScope } from './scope'

const byStart = (a: LessonDoc, b: LessonDoc) =>
  (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0)

// A class's lessons, oldest first, optionally for one subject. Nothing is
// loaded until there is a class (and a subject, when one is asked for).
export function useCohortLessons(cohortId: string | null | undefined, opts: { subjectId?: string } = {}) {
  const { subjectId } = opts
  const wantsSubject = 'subjectId' in opts
  const enabled = !!cohortId && (!wantsSubject || !!subjectId)
  const constraints: QueryConstraint[] = enabled
    ? [where('cohortId', '==', cohortId), ...(subjectId ? [where('subjectId', '==', subjectId)] : [])]
    : []
  const res = useCollection<LessonDoc>('lessons', constraints, enabled, `${cohortId ?? ''}-${subjectId ?? ''}`)
  const lessons = useMemo(() => [...res.data].sort(byStart), [res.data])
  return { ...res, data: lessons }
}

function scopeConstraints(scope: SyncedEventScope): QueryConstraint[] {
  switch (scope.kind) {
    case 'class':       return [where('cohortId', 'in', [scope.cohortId, 'all'])]
    case 'shared-only': return [where('cohortId', '==', 'all')]
    default:            return []
  }
}

function scopeKey(scope: SyncedEventScope) {
  return scope.kind === 'class' ? `class:${scope.cohortId}` : scope.kind
}

// Outlook events the viewer may see, optionally for one subject.
//   everyClass:    staff outside preview see every class's events
//   requireCohort: load nothing without a class (instead of only 'all' events)
export function useVisibleEvents(opts: {
  cohortId: string | null | undefined
  everyClass?: boolean
  requireCohort?: boolean
  subjectId?: string
}) {
  const scope = syncedEventScope(opts)
  const wantsSubject = 'subjectId' in opts
  const enabled = scope.kind !== 'none' && (!wantsSubject || !!opts.subjectId)
  const constraints: QueryConstraint[] = enabled
    ? [...(opts.subjectId ? [where('subjectId', '==', opts.subjectId)] : []), ...scopeConstraints(scope)]
    : []
  return useCollection<SyncedEventDoc>(
    'synced_events',
    constraints,
    enabled,
    `synced-${scopeKey(scope)}-${opts.subjectId ?? ''}`,
  )
}
