import { useCollection, where, orderBy } from './useFirestore'
import type { PointsLogDoc } from '@/types'
import { useAuth } from '@/contexts/AuthContext'

export function useMyPointsLog(limit = 20) {
  const { user } = useAuth()
  return useCollection<PointsLogDoc>(
    'points_log',
    user
      ? [where('studentId', '==', user.uid), orderBy('createdAt', 'desc')]
      : [],
    !!user,
  )
}
