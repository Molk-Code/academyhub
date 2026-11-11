import { useCollection, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'

interface NewContactRequest { id: string; status: string }

export function useContactRequestBadge(): number {
  const { role, roles, profile } = useAuth()
  // contact_requests is admin-only readable (firestore.rules)
  const isAdmin = roles.includes('admin') || (role ?? profile?.role) === 'admin'

  const { data: fresh } = useCollection<NewContactRequest>(
    'contact_requests',
    [where('status', '==', 'new')],
    isAdmin,
  )

  return isAdmin ? fresh.length : 0
}
