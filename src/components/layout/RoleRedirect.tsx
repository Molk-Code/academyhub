import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function RoleRedirect() {
  const { loading, user, role } = useAuth()

  if (loading)        return <LoadingSpinner fullScreen />
  if (!user)          return <Navigate to="/login" replace />
  if (!role)          return <LoadingSpinner fullScreen />

  if (role === 'admin')   return <Navigate to="/admin/users"  replace />
  if (role === 'teacher') return <Navigate to="/teacher"      replace />
  return                         <Navigate to="/my-plan"      replace />
}
