import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { usePublicConfig } from '@/lib/publicConfig'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function RoleRedirect() {
  const { loading, user, role } = useAuth()
  const { config, loading: configLoading } = usePublicConfig()

  // The rental shop's own address (public_config/main.shopDomain) opens on the shop
  if (configLoading)  return <LoadingSpinner fullScreen />
  if (config?.shopDomain && window.location.hostname === config.shopDomain) return <Navigate to="/shop" replace />

  if (loading)        return <LoadingSpinner fullScreen />
  if (!user)          return <Navigate to="/login" replace />
  if (!role)          return <LoadingSpinner fullScreen />

  if (role === 'admin')   return <Navigate to="/admin/dashboard" replace />
  if (role === 'teacher') return <Navigate to="/teacher"      replace />
  return                         <Navigate to="/dashboard"    replace />
}
