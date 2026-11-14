import { describe, it, expect } from 'vitest'
import { notificationTarget } from './notificationLinks'
import type { UserRole } from '@/types'

// Every link a server notification can carry must open a real page for every
// role, after notificationTarget's mapping. Catches a renamed route or a new
// notification pointing at a page some recipients can't open.
const app = (import.meta.glob('/src/App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['/src/App.tsx']
const fns = import.meta.glob('/functions/src/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const routes = [...app.matchAll(/path="([^"]+)"/g)].map(m => m[1]).filter(p => p !== '*')
// Which roles may open a route: by its prefix, like the RoleRoute guards in App.tsx
const allowed = (path: string): UserRole[] =>
  path.startsWith('/admin') ? ['admin'] : path.startsWith('/teacher') ? ['teacher', 'admin'] : ['student', 'admin', 'teacher']
const STUDENT_LAYOUT = new Set(['/dashboard', '/calendar', '/assignments', '/my-bookings', '/booking', '/booking/equipment', '/chat', '/bug-reports', '/prizes', '/my-plan', '/semester'])

function routeFor(path: string): string | undefined {
  return routes.find(r => new RegExp(`^${r.replace(/:[^/]+/g, '[^/]+')}$`).test(path))
}
function canOpen(path: string, role: UserRole): boolean {
  const r = routeFor(path)
  if (!r) return false
  if (STUDENT_LAYOUT.has(r) || r.startsWith('/assignments') || r.startsWith('/submissions')) return role !== 'teacher'
  return allowed(r).includes(role)
}

// Sent with pushToAdmins: only admins receive these
const ADMINS_ONLY = new Set(['/admin/food-box-orders', '/admin/minivan'])

// Links in the functions code: url: '…' / `…`, and '/…' arguments on a line of their own
const links = new Set<string>()
for (const src of Object.values(fns)) {
  for (const m of src.matchAll(/(?:url:\s*|^\s*)[`']((?:\/[a-z][\w-]*)+[^`'\s]*)[`']/gm)) {
    if (m[1].startsWith('/login') || m[1].includes('icons/')) continue
    links.add(m[1].replace(/\$\{[^}]+\}/g, 'x'))
  }
}

describe('notification links open a page for every role', () => {
  it('finds the links', () => expect(links.size).toBeGreaterThan(15))
  for (const link of links) {
    const path = link.split('?')[0]
    // Staff-only links only reach staff, student-only content (assignments, plan, prizes, results) only students
    const recipients: UserRole[] = ADMINS_ONLY.has(path) ? ['admin']
      : path.startsWith('/admin') || path.startsWith('/teacher') ? ['teacher', 'admin']
      : /^\/(assignments|submissions|my-plan|prizes|dashboard)/.test(path) ? ['student'] : ['student', 'teacher', 'admin']
    for (const role of recipients) {
      it(`${link} as ${role}`, () => {
        const target = notificationTarget(link, role).split('?')[0]
        expect(canOpen(target, role), `${link} → ${target}`).toBe(true)
      })
    }
  }
})
