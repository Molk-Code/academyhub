import type { UserRole } from '@/types'
import { safeRedirect } from './safeRedirect'

// Where a notification (push or bell) takes the user. The server stores one
// link per notification, written for the typical recipient (e.g. /my-bookings
// for a student, /admin/equipment for staff), but the same notification can
// reach someone whose active role uses a different page for the same thing —
// a teacher booking equipment, a teacher responsible for a category, or an
// admin switched to teacher. This maps the link to the page that role can
// open, keeping the query (?focus=<id>, ?tab=…, ?channel=…) so the page can
// open the exact item.

const BY_ROLE: Record<UserRole, Record<string, string>> = {
  student: {
    '/teacher/my-bookings':        '/my-bookings',
    '/teacher/booking/equipment':  '/booking/equipment',
    '/teacher/bug-reports':        '/bug-reports',
    '/teacher/chat':               '/chat',
    '/admin/chat':                 '/chat',
  },
  teacher: {
    '/my-bookings':                '/teacher/my-bookings',
    '/booking/equipment':          '/teacher/booking/equipment',
    '/bug-reports':                '/teacher/bug-reports',
    '/admin/bug-reports':          '/teacher/bug-reports',
    '/chat':                       '/teacher/chat',
    '/admin/chat':                 '/teacher/chat',
    '/admin/equipment':            '/teacher/equipment-requests',
    '/admin/inventory':            '/teacher/inventory',
    '/booking':                    '/teacher/room-bookings',
    '/calendar':                   '/teacher/lessons',
    '/admin':                      '/teacher',
    '/admin/dashboard':            '/teacher',
  },
  admin: {
    // Admins can open student and teacher pages too; only send them to the admin version where there is one
    '/chat':                       '/admin/chat',
    '/teacher/chat':               '/admin/chat',
    '/teacher/equipment-requests': '/admin/equipment',
    '/teacher/inventory':          '/admin/inventory',
  },
}

// Query parameters a mapped page understands, added when the target needs them
const ADD_QUERY: Record<string, Record<string, string>> = {
  '/admin/equipment': { tab: 'bookings' },
}

/** The in-app path a notification link should open for a user with this active role. */
export function notificationTarget(url: string | null | undefined, role: UserRole | null | undefined): string {
  let parsed: URL
  try { parsed = new URL(url || '/', 'https://app.invalid') } catch { return '/' }
  // Absolute links from older notifications: only the path matters, and only inside the app
  const path = parsed.pathname.replace(/\/+$/, '') || '/'
  const mapped = (role && BY_ROLE[role]?.[path]) || path
  const query = new URLSearchParams(parsed.search)
  // A tab chosen for another page doesn't apply to the mapped one
  if (mapped !== path) query.delete('tab')
  for (const [k, v] of Object.entries(ADD_QUERY[mapped] ?? {})) if (!query.has(k)) query.set(k, v)
  const qs = query.toString()
  return safeRedirect(`${mapped}${qs ? `?${qs}` : ''}${parsed.hash}`)
}

/** /open?to=<link>: the page a push opens when the app isn't running yet (see firebase-messaging-sw.js). */
export function openLinkPath(url: string): string {
  return `/open?to=${encodeURIComponent(url)}`
}
