import { Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import type { UserRole } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

interface Props {
  role: UserRole | UserRole[]
  children: React.ReactNode
  skeleton?: React.ReactNode
}

export default function RoleRoute({ role, children, skeleton }: Props) {
  const { user, role: userRole, roles: userRoles, loading, refreshToken } = useAuth()

  // If authenticated but role still null after 6 s, force a token refresh
  // (handles race where Cloud Function sets claims after initial token fetch)
  useEffect(() => {
    if (!user || userRole || loading) return
    const id = setTimeout(async () => { await refreshToken() }, 6000)
    return () => clearTimeout(id)
  }, [user, userRole, loading])

  if (loading) return skeleton ? <>{skeleton}</> : <LoadingSpinner fullScreen />

  if (!user) return <Navigate to="/login" replace />

  // Role still resolving — show spinner (AuthContext sets from Firestore fallback)
  if (!userRole) return skeleton ? <>{skeleton}</> : <LoadingSpinner fullScreen />

  const allowed = Array.isArray(role) ? role : [role]
  // Grant access if primary role OR any role in the user's roles array matches
  const hasAccess = allowed.includes(userRole) || userRoles.some(r => allowed.includes(r as UserRole))
  if (!hasAccess) {
    if (userRoles.includes('teacher') || userRole === 'teacher') return <Navigate to="/teacher"     replace />
    if (userRoles.includes('admin')   || userRole === 'admin')   return <Navigate to="/admin/users" replace />
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
