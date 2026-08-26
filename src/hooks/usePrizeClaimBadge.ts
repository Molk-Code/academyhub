import { useCollection, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import type { PrizeClaimDoc } from '@/types'

export function usePrizeClaimBadge(): number {
  const { role, roles, profile } = useAuth()
  const isStaff = roles.some(r => r === 'teacher' || r === 'admin')
    || (role ?? profile?.role) === 'teacher'
    || (role ?? profile?.role) === 'admin'

  const { data: pending } = useCollection<PrizeClaimDoc>(
    'prize_claims',
    [where('status', '==', 'pending')],
    isStaff,
  )

  return isStaff ? pending.length : 0
}
