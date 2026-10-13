import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useDocument } from '@/hooks/useFirestore'

interface NavVisDoc {
  id: string
  student?: Record<string, boolean>
  teacher?: Record<string, boolean>
}

// Nav Settings only ever hid a feature's link in the sidebar — the route
// itself stayed reachable to anyone who knew (or bookmarked) the URL. This
// gate makes the toggle actually block access for the role it targets.
export default function NavVisibilityGate({
  featureId,
  role,
  redirectTo,
  children,
}: {
  featureId: string
  role: 'student' | 'teacher'
  redirectTo: string
  children: React.ReactNode
}) {
  const { role: activeRole } = useAuth()
  const { data: navVis, loading } = useDocument<NavVisDoc>('settings', 'nav_visibility')

  // Admin previewing this layout (not a real student/teacher) always keeps
  // access — the toggle is meant to hide the feature from that role, not
  // lock staff out of moderating it.
  if (activeRole === 'admin') return <>{children}</>
  if (loading) return null
  if (navVis?.[role]?.[featureId] === false) return <Navigate to={redirectTo} replace />
  return <>{children}</>
}
