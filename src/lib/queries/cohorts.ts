import { useCallback, useMemo } from 'react'
import { useCollection } from '@/hooks/useFirestore'
import type { CohortDoc } from '@/types'
import { sortCohorts } from './scope'

// Every class list goes through here. `data` is the classes to pick from
// (archived ones left out, sorted by name); `all` and `cohortOf` include
// archived classes, for showing the class of older lessons, users or results.
export function useCohorts({ enabled = true }: { enabled?: boolean } = {}) {
  const { data: raw, loading, error, retry } = useCollection<CohortDoc>('cohorts', [], enabled)
  const { active, all } = useMemo(() => sortCohorts(raw), [raw])
  const byId = useMemo(() => new Map(all.map(c => [c.id, c])), [all])
  const cohortOf = useCallback((id: string | null | undefined) => (id ? byId.get(id) : undefined), [byId])
  return { data: active, all, cohortOf, loading, error, retry }
}
