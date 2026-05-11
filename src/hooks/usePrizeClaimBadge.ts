import { useCollection, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import type { PrizeClaimDoc } from '@/types'

export function usePrizeClaimBadge(): number {
  const { role } = useAuth()
  const isStaff = role === 'teacher' || role === 'admin'

  const { data: pending } = useCollection<PrizeClaimDoc>(
    'prize_claims',
    [where('status', '==', 'pending')],
    isStaff,
  )

  return isStaff ? pending.length : 0
}
