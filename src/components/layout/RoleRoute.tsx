import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

interface Props {
  role: UserRole | UserRole[]
  children: React.ReactNode
  skeleton?: React.ReactNode
}

export default function RoleRoute({ role, children, skeleton }: Props) {
  const { user, role: userRole, loading } = useAuth()

  if (loading) return skeleton ? <>{skeleton}</> : <LoadingSpinner fullScreen />

  if (!user) return <Navigate to="/login" replace />

  // User is authenticated but role hasn't been read from the token yet — wait
  if (!userRole) return <LoadingSpinner fullScreen />

  const allowed = Array.isArray(role) ? role : [role]
  if (!allowed.includes(userRole)) {
    // Redirect each role to its own home
    if (userRole === 'teacher') return <Navigate to="/teacher" replace />
    if (userRole === 'admin')   return <Navigate to="/admin"   replace />
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
