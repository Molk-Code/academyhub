import { Navigate } from 'react-router-dom'
import { useFeature } from '@/hooks/useFeature'
import type { Feature } from '@/lib/features'

interface Props {
  feature: Feature
  children: React.ReactNode
  redirectTo?: string
}

export default function FeatureGate({ feature, children, redirectTo = '/upgrade' }: Props) {
  const allowed = useFeature(feature)
  if (!allowed) return <Navigate to={redirectTo} replace />
  return <>{children}</>
}
