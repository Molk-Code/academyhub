import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Users, CalendarDays, ClipboardList, BookMarked,
  Gift, LogOut, Film, Menu, X, MessageSquare, BookOpen,
  Clapperboard, Video, DoorOpen, ArrowLeftRight, User, CircleDot,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSchool } from '@/contexts/SchoolContext'
import { useFeature } from '@/hooks/useFeature'
import { cn } from '@/lib/utils'
import Avatar from '@/components/common/Avatar'
import firePng from '@/assets/fire.png'
import { useChatUnreadCount } from '@/hooks/useChatUnread'
import { useBookingBadge } from '@/hooks/useBookingBadge'
import { useAppBadge } from '@/hooks/useAppBadge'
import NotificationPermissionBanner from '@/components/NotificationPermissionBanner'
import CompleteProfileGate from '@/components/CompleteProfileGate'
import { AttendanceProvider, useAttendance } from '@/contexts/AttendanceContext'
import AttendancePanel from '@/components/attendance/AttendancePanel'

interface NavItem {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  showUnread?: boolean
  showBooking?: boolean
  exact?: boolean
}

const NAV: NavItem[] = [
  { to: '/teacher',             icon: LayoutDashboard, label: 'Dashboard',    exact: true },
  { to: '/teacher/students',    icon: Users,           label: 'Students'     },
  { to: '/teacher/lessons',     icon: CalendarDays,    label: 'Calendar'     },
  { to: '/teacher/assignments', icon: ClipboardList,   label: 'Assignments'  },
  { to: '/teacher/gradebook',   icon: BookMarked,      label: 'Grade Book'   },
  { to: '/teacher/subjects',    icon: BookOpen,        label: 'Subjects'     },
  { to: '/teacher/prizes',      icon: Gift,            label: 'Prizes'       },
  { to: '/teacher/room-bookings', icon: DoorOpen,      label: 'Bookings',    showBooking: true },
  { to: '/teacher/chat',        icon: MessageSquare,   label: 'Chat',        showUnread: true  },
  { to: '/teacher/production',  icon: Clapperboard,    label: 'Production'   },
  { to: '/teacher/resources',   icon: BookMarked,      label: 'Resources'    },
  { to: '/teacher/videos',      icon: Video,           label: 'Videos'       },
  { to: '/teacher/guide',           icon: BookOpen,    label: 'FAQ'            },
  { to: '/teacher/semester-wheel',  icon: CircleDot,   label: 'Semester Wheel' },
]

function AttendanceOverlay() {
  const { lessonId, lessonTitle, visible, externalDeviceName, stopAttendance, openPanel, dismissPanel, setExternalDeviceName } = useAttendance()
  if (!lessonId) return null
  return (
    <>
      <AttendancePanel
        lessonId={lessonId}
        lessonTitle={lessonTitle}
        visible={visible}
        onClose={stopAttendance}
        onDismiss={dismissPanel}
        onExternalStart={(name) => setExternalDeviceName(name)}
        onExternalStop={() => setExternalDeviceName('')}
      />
      {!visible && externalDeviceName && (
        <button
          onClick={openPanel}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 bg-violet-900/90 border border-violet-600/60 text-violet-100 rounded-2xl px-4 py-3 shadow-2xl backdrop-blur-sm hover:bg-violet-800/90 transition-colors"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-300" />
          </span>
          <div className="text-left">
            <p className="text-xs font-bold leading-none">Attendance Active</p>
            <p className="text-[10px] text-violet-300 mt-0.5 leading-none">{externalDeviceName}</p>
          </div>
        </button>
      )}
    </>
  )
}

export default function TeacherLayout() {
  const { profile, role, signOut } = useAuth()
  const { shortName } = useSchool()
  const videoLabEnabled = useFeature('videoLab')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isChatPage  = pathname.endsWith('/chat')
  const isVideoPage = /\/videos\/[^/]+$/.test(pathname)
  const isGuidePage = pathname.endsWith('/guide')

  const chatUnread  = useChatUnreadCount()
  const bookingBadge = useBookingBadge()
  const totalBadge  = chatUnread + bookingBadge
  useAppBadge(totalBadge)

  const canSwitchToAdmin = role === 'admin'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <>
        {NAV.map(({ to, icon: Icon, label, showUnread, showBooking, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-brand-500/15 text-brand-400'
                  : 'text-[#86bbd8] hover:text-[#f0f4f8] hover:bg-white/5',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-brand-400' : 'text-[#5a7a8e]')} />
                <span className="flex-1">{label}</span>
                {showUnread && chatUnread > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold px-1 leading-none">
                    {chatUnread}
                  </span>
                )}
                {showBooking && bookingBadge > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1 leading-none">
                    {bookingBadge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
        {videoLabEnabled && <NavLink
          to="/teacher/video-lab"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
              isActive ? 'bg-gold-400/20 text-gold-400' : 'text-gold-400 hover:bg-gold-400/10 hover:text-gold-300',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Film className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-gold-400' : 'text-gold-400/70')} />
              <span className="flex-1">Video Lab 🎬</span>
              <span className="text-[10px] font-bold bg-gold-400/10 text-gold-400 px-1.5 py-0.5 rounded-full border border-gold-400/30 leading-none">Beta</span>
            </>
          )}
        </NavLink>}
      </>
    )
  }

  const SidebarFooter = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="p-3 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
      {canSwitchToAdmin && (
        <button
          onClick={() => { navigate('/admin'); onNavigate?.() }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-[#86bbd8] hover:text-[#f0f4f8] hover:bg-white/5 transition-all"
        >
          <ArrowLeftRight className="w-4 h-4" />
          Switch to Admin view
        </button>
      )}
      <Link
        to="/teacher/profile"
        onClick={onNavigate}
        className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors group"
      >
        <Avatar uid={profile?.uid ?? 'x'} name={profile?.displayName ?? '?'} avatarUrl={profile?.avatarUrl} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#f0f4f8] truncate">{profile?.displayName}</p>
          <p className="text-xs text-[#5a7a8e] truncate">Teacher</p>
        </div>
        <button
          onClick={e => { e.preventDefault(); handleSignOut() }}
          className="p-1.5 rounded-lg text-[#5a7a8e] hover:text-[#f0f4f8] hover:bg-white/10 transition-colors"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </Link>
    </div>
  )

  return (
    <AttendanceProvider>
    <CompleteProfileGate>
    <div className="flex overflow-hidden" style={{ height: '100dvh', background: 'var(--bg-primary)' }}>

      {/* ── Mobile top header ──────────────────────────────────────────────── */}
      <header className="mobile-header lg:hidden fixed top-0 left-0 right-0 z-40 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="h-14 flex items-center justify-between px-4">
          <Link to="/teacher" className="flex items-center gap-2.5">
            <img src={firePng} alt="CineForge" className="w-7 h-7 object-contain" />
            <div>
              <span className="text-sm font-bold text-[#f0f4f8] tracking-tight leading-none block">{shortName}</span>
              <span className="text-[10px] text-[#86bbd8] leading-none">Teacher Portal</span>
            </div>
          </Link>
          <button
            onClick={() => setDrawerOpen(true)}
            className="relative p-2 rounded-xl text-[#86bbd8] hover:text-[#f0f4f8] hover:bg-white/10 transition-colors"
          >
            <Menu className="w-5 h-5" />
            {totalBadge > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold px-1 leading-none">
                {totalBadge > 99 ? '99+' : totalBadge}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── Mobile drawer overlay ──────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 flex flex-col shadow-2xl" style={{ background: 'var(--bg-surface)' }}>
            <div className="h-14 flex items-center justify-between px-5 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
              <Link to="/teacher" onClick={() => setDrawerOpen(false)} className="flex items-center gap-2.5">
                <img src={firePng} alt="CineForge" className="w-7 h-7 object-contain" />
                <div>
                  <span className="text-sm font-bold text-[#f0f4f8] block leading-none">{shortName}</span>
                  <span className="text-[10px] text-[#86bbd8] leading-none">Teacher Portal</span>
                </div>
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-xl text-[#86bbd8] hover:text-[#f0f4f8] hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              <NavLinks onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <SidebarFooter onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-64 flex-col flex-shrink-0 border-r" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="h-16 flex items-center gap-3 px-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <Link to="/teacher" className="flex items-center gap-3">
            <img src={firePng} alt="CineForge" className="w-8 h-8 object-contain" />
            <div>
              <span className="text-base font-bold text-[#f0f4f8] tracking-tight">{shortName}</span>
              <span className="block text-xs text-[#86bbd8] -mt-0.5">Teacher Portal</span>
            </div>
          </Link>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <NavLinks />
        </nav>
        <SidebarFooter />
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main
        className={cn(
          'flex-1 pt-header lg:pt-0',
          (isChatPage || isVideoPage) ? 'overflow-hidden flex flex-col' : 'overflow-y-auto',
        )}
      >
        <NotificationPermissionBanner />
        {(isChatPage || isVideoPage) ? (
          <Outlet />
        ) : (
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="max-w-6xl mx-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-8"
          >
            <Outlet />
          </motion.div>
        )}
      </main>
      <AttendanceOverlay />
    </div>
    </CompleteProfileGate>
    </AttendanceProvider>
  )
}
