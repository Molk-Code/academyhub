import { useAuth } from '@/contexts/AuthContext'
import { resolveViewCohortId } from './scope'

// The class a student-route screen shows (see resolveViewCohortId)
export function useViewCohortId(): string | null {
  const { previewCohortId, cohortId, profile } = useAuth()
  return resolveViewCohortId(previewCohortId, cohortId, profile?.cohortId)
}
