import { useCollection, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'

interface OpenBugReport { id: string; status: string }

export function useBugReportBadge(): number {
  const { role, roles, profile } = useAuth()
  // bug_reports is admin-only readable (firestore.rules) — teachers can't query it
  const isAdmin = roles.includes('admin') || (role ?? profile?.role) === 'admin'

  const { data: open } = useCollection<OpenBugReport>(
    'bug_reports',
    [where('status', '==', 'open')],
    isAdmin,
  )

  return isAdmin ? open.length : 0
}
