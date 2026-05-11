import { useState, useEffect, useMemo } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Calendar, BookOpen,
  Trophy, LogOut, ArrowLeft, QrCode, ClipboardList, DoorOpen,
  MessageSquare, Clapperboard, Film, FolderOpen, Menu, X, ListChecks, User,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSchool } from '@/contexts/SchoolContext'
import { useFeature } from '@/hooks/useFeature'
import { useDocument } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import Avatar from '@/components/common/Avatar'
import { useChatUnreadCount } from '@/hooks/useChatUnread'
import { useBookingBadge } from '@/hooks/useBookingBadge'
import { useAppBadge } from '@/hooks/useAppBadge'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import firePng from '@/assets/fire.png'
import { Download } from 'lucide-react'
import CompleteProfileGate from '@/components/CompleteProfileGate'
import NotificationPermissionBanner from '@/components/NotificationPermissionBanner'

interface NavItem {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  showUnread?: boolean
  showBooking?: boolean
  featureId?: string
}

const ALL_NAV: NavItem[] = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/calendar',    icon: Calendar,        label: 'Calendar',    featureId: 'calendar'    },
  { to: '/chat',        icon: MessageSquare,   label: 'Chat',        featureId: 'chat',        showUnread: true },
  { to: '/checkin',     icon: QrCode,          label: 'Check In',    featureId: 'checkin'     },
  { to: '/assignments', icon: ClipboardList,   label: 'Assignments', featureId: 'assignments' },
  { to: '/booking',     icon: DoorOpen,        label: 'Booking',     featureId: 'booking',    showBooking: true },
  { to: '/subjects',    icon: BookOpen,        label: 'Subjects',    featureId: 'subjects'    },
  { to: '/production',  icon: Clapperboard,    label: 'Production',  featureId: 'production'  },
  { to: '/prizes',      icon: Trophy,          label: 'Prizes',      featureId: 'prizes'      },
  { to: '/resources',   icon: FolderOpen,      label: 'Resources',   featureId: 'resources'   },
  { to: '/my-plan',     icon: ListChecks,      label: 'My Plan',     featureId: 'myPlan'      },
  { to: '/guide',       icon: BookOpen,        label: 'FAQ',         featureId: 'guide'       },
]

export default function StudentLayout() {
  const { profile, role, signOut } = useAuth()
  const { shortName } = useSchool()
  const videoLabEnabled = useFeature('videoLab')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isChatPage     = pathname.endsWith('/chat')
  const isVideoPage    = /\/videos\/[^/]+$/.test(pathname)
  const isGuidePage    = pathname.endsWith('/guide')
  const isAdminPreview = role === 'admin'
  const chatUnread     = useChatUnreadCount()
  const bookingBadge   = useBookingBadge()
  const totalBadge     = chatUnread + bookingBadge
  useAppBadge(totalBadge)
  const { canInstall, install } = usePwaInstall()

  const { data: navVis } = useDocument<{ id: string; student: Record<string, boolean> }>('settings', 'nav_visibility')
  const { data: schoolDoc } = useDocument<{ id: string; name?: string }>('settings', 'school')
  const schoolName = schoolDoc?.name ?? ''
  const nav = useMemo(
    () => ALL_NAV.filter(item => !item.featureId || navVis?.student?.[item.featureId] !== false),
    [navVis],
  )

  const showCalendar = navVis?.student?.calendar !== false
  const showChat     = navVis?.student?.chat     !== false
  const showBooking  = navVis?.student?.booking  !== false


  useEffect(() => { setDrawerOpen(false) }, [pathname])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <>
        {nav.map(({ to, icon: Icon, label, showUnread, showBooking }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-brand-500/15 text-brand-400'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-brand-400' : 'text-zinc-500')} />
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
          to="/video-lab"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
              isActive
                ? 'bg-amber-500/20 text-amber-300'
                : 'text-amber-400 hover:bg-amber-900/20 hover:text-amber-300',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Film className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-amber-500' : 'text-amber-400')} />
              <span className="flex-1">Video Lab 🎬</span>
              <span className="text-[10px] font-bold bg-amber-900/30 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-700/40 leading-none">Beta</span>
            </>
          )}
        </NavLink>}
      </>
    )
  }

  const UserFooter = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="p-3 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
      {canInstall && (
        <button
          onClick={() => { install(); onNavigate?.() }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-brand-400 hover:bg-white/5 transition-colors"
        >
          <Download className="w-4 h-4" />
          Install App
        </button>
      )}
      <Link
        to="/profile"
        onClick={onNavigate}
        className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors group"
      >
        <Avatar uid={profile?.uid ?? 'x'} name={profile?.displayName ?? '?'} avatarUrl={profile?.avatarUrl} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{profile?.displayName}</p>
          <p className="text-xs text-zinc-500 truncate">{profile?.email}</p>
        </div>
        <button
          onClick={e => { e.preventDefault(); handleSignOut() }}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-white/10 transition-colors"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </Link>
    </div>
  )

  return (
    <CompleteProfileGate>
    <div className="flex overflow-hidden" style={{ height: '100dvh', background: 'var(--bg-primary)' }}>

      {/* ── Mobile top header ──────────────────────────────────────────────── */}
      <header className="mobile-header lg:hidden fixed top-0 left-0 right-0 z-40 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="h-16 flex items-center justify-between px-4">
          <Link to="/dashboard" className="flex items-end gap-2.5 overflow-hidden max-w-[calc(100vw-6rem)]">
            <img src={firePng} alt="CineForge" className="w-7 h-7 object-contain flex-shrink-0" />
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-zinc-100 tracking-tight leading-none">{shortName}</p>
              {schoolName && <p className="text-[9px] text-zinc-500 tracking-tight mt-[3px] leading-none whitespace-nowrap overflow-hidden text-ellipsis">{schoolName}</p>}
            </div>
          </Link>
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-xl text-zinc-400 hover:bg-white/10 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ── Mobile drawer overlay ──────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 flex flex-col shadow-2xl" style={{ background: 'var(--bg-surface)' }}>
            <div className="h-14 flex items-center justify-between px-5 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
              <Link to="/dashboard" onClick={() => setDrawerOpen(false)} className="flex items-end gap-2.5 overflow-hidden">
                <img src={firePng} alt="CineForge" className="w-7 h-7 object-contain flex-shrink-0" />
                <div className="overflow-hidden">
                  <p className="text-sm font-bold text-zinc-100 tracking-tight leading-none">{shortName}</p>
                  {schoolName && <p className="text-[9px] text-zinc-500 tracking-tight mt-[3px] leading-none whitespace-nowrap overflow-hidden text-ellipsis">{schoolName}</p>}
                </div>
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-xl text-zinc-400 hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              <NavLinks onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <UserFooter onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-64 flex-col flex-shrink-0 border-r" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="h-16 flex items-center gap-3 px-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <Link to="/dashboard" className="flex items-end gap-3 overflow-hidden w-full">
            <img src={firePng} alt="CineForge" className="w-8 h-8 object-contain flex-shrink-0" />
            <div className="overflow-hidden">
              <p className="text-base font-bold text-zinc-100 tracking-tight leading-none">{shortName}</p>
              {schoolName && <p className="text-[9px] text-zinc-500 tracking-tight mt-[3px] leading-none whitespace-nowrap overflow-hidden text-ellipsis">{schoolName}</p>}
            </div>
          </Link>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <NavLinks />
        </nav>
        <UserFooter />
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main
        className={cn(
          'flex-1 overflow-y-auto pt-header lg:pt-0',
          (isChatPage || isVideoPage) && 'overflow-hidden flex flex-col',
        )}
      >
        <NotificationPermissionBanner />
        {isAdminPreview && (
          <div className="bg-rose-600 text-white text-xs font-semibold px-4 py-2 flex items-center gap-2">
            <span className="flex-1">ADMIN PREVIEW — viewing as student</span>
            <button
              onClick={() => navigate('/admin')}
              className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2 py-1 rounded-md transition-colors"
            >
              <ArrowLeft className="w-3 h-3" /> Back to Admin
            </button>
          </div>
        )}
        {(isChatPage || isVideoPage) ? (
          <Outlet />
        ) : (
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="max-w-6xl mx-auto px-4 py-5 pb-bottomnav lg:pb-8 sm:px-6 lg:px-8 lg:py-8"
          >
            <Outlet />
          </motion.div>
        )}
      </main>

      {/* ── Mobile bottom tab bar ──────────────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-stretch h-16" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {/* Home */}
          <NavLink to="/dashboard" className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-zinc-500',
          )}>
            {({ isActive }) => (<>
              <LayoutDashboard className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
              <span>Home</span>
            </>)}
          </NavLink>
          {/* Calendar */}
          <NavLink to="/calendar" className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-zinc-500',
          )}>
            {({ isActive }) => (<>
              <Calendar className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
              <span>Calendar</span>
            </>)}
          </NavLink>
          {/* Check In */}
          <NavLink to="/checkin" className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-zinc-500',
          )}>
            {({ isActive }) => (<>
              <QrCode className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
              <span>Check In</span>
            </>)}
          </NavLink>
          {/* Chat */}
          <NavLink to="/chat" className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors relative',
            isActive ? 'text-brand-400' : 'text-zinc-500',
          )}>
            {({ isActive }) => (<>
              <div className="relative">
                <MessageSquare className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
                {chatUnread > 0 && (
                  <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-full bg-brand-500 text-white text-[8px] font-bold px-0.5 leading-none">
                    {chatUnread > 9 ? '9+' : chatUnread}
                  </span>
                )}
              </div>
              <span>Chat</span>
            </>)}
          </NavLink>
          {/* Profile */}
          <NavLink to="/profile" className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-zinc-500',
          )}>
            {({ isActive }) => (<>
              <User className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
              <span>Profile</span>
            </>)}
          </NavLink>
        </div>
      </nav>
    </div>
    </CompleteProfileGate>
  )
}
