import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Users, CalendarDays,
  ClipboardList, BookMarked, Gift, LogOut, Film,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn, initials, avatarColor } from '@/lib/utils'

const nav = [
  { to: '/teacher',            icon: LayoutDashboard, label: 'Overview'    },
  { to: '/teacher/students',   icon: Users,           label: 'Students'    },
  { to: '/teacher/lessons',    icon: CalendarDays,    label: 'Lessons'     },
  { to: '/teacher/gradebook',  icon: ClipboardList,   label: 'Grade Book'  },
  { to: '/teacher/resources',  icon: BookMarked,      label: 'Resources'   },
  { to: '/teacher/prizes',     icon: Gift,            label: 'Prizes'      },
]

export default function TeacherLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="w-64 bg-slate-900 flex flex-col shadow-xl">
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-700/50">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
            <Film className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-base font-bold text-white tracking-tight">CineForge</span>
            <span className="block text-xs text-slate-400 -mt-0.5">Teacher Portal</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/teacher'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('w-5 h-5', isActive ? 'text-white' : 'text-slate-500')} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-700/50">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0',
              avatarColor(profile?.uid ?? 'x'),
            )}>
              {initials(profile?.displayName ?? '?')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{profile?.displayName}</p>
              <p className="text-xs text-slate-400 truncate">Teacher</p>
            </div>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="max-w-6xl mx-auto px-8 py-8"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  )
}
