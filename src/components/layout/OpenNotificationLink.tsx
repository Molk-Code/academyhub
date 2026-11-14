import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { notificationTarget, openLinkPath } from '@/lib/notificationLinks'

// /open?to=<link> — where a push notification opens the app when it isn't
// running (firebase-messaging-sw.js). Waits for sign-in to settle, then goes to
// the link's page for the user's active role. Signed out: sign in first, then
// come back here.
export default function OpenNotificationLink() {
  const [params] = useSearchParams()
  const { user, role, loading } = useAuth()
  const to = params.get('to') ?? '/'
  if (loading || (user && !role)) return <div className="min-h-screen bg-zinc-950" />
  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(openLinkPath(to))}`} replace />
  return <Navigate to={notificationTarget(to, role)} replace />
}
