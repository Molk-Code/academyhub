import { useState, useMemo, Suspense } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Users, CalendarDays, ClipboardList, BookMarked,
  Gift, LogOut, Film, Menu, X, MessageSquare, BookOpen,
  Clapperboard, Video, DoorOpen, ArrowLeftRight, User, CircleDot, CalendarRange,
  Package, ArchiveRestore, ExternalLink,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSchool } from '@/contexts/SchoolContext'
import { useFeature } from '@/hooks/useFeature'
import type { Feature } from '@/lib/features'
import { useDocument } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import Avatar from '@/components/common/Avatar'
import firePng from '@/assets/fire.png'
import { useChatUnreadCount } from '@/hooks/useChatUnread'
import { useBookingBadge, useBookingBadgeDetail } from '@/hooks/useBookingBadge'
import { useCalendarInviteBadge } from '@/hooks/useCalendarInviteBadge'
import { useAppBadge } from '@/hooks/useAppBadge'
import NotificationPermissionBanner from '@/components/NotificationPermissionBanner'
import NotificationInbox from '@/components/NotificationInbox'
import CompleteProfileGate from '@/components/CompleteProfileGate'
import { AttendanceProvider, useAttendance } from '@/contexts/AttendanceContext'
import AttendancePanel from '@/components/attendance/AttendancePanel'

interface NavItem {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  featureId?: string
  tierFeature?: Feature
  showUnread?: boolean
  showBooking?: boolean
  showCalendarBadge?: boolean
  showEquipmentBadge?: boolean
  exact?: boolean
}

const NAV: NavItem[] = [
  { to: '/teacher',               icon: LayoutDashboard, label: 'Dashboard',      exact: true },
  { to: '/teacher/students',      icon: Users,           label: 'Students',       featureId: 'students'                                      },
  { to: '/teacher/lessons',       icon: CalendarDays,    label: 'Calendar',       featureId: 'calendar',     showCalendarBadge: true, tierFeature: 'lessons'   },
  { to: '/teacher/assignments',   icon: ClipboardList,   label: 'Assignments',    featureId: 'assignments',                           tierFeature: 'assignments' },
  { to: '/teacher/notebook',      icon: BookMarked,      label: 'Notebook',       featureId: 'notebook'                                      },
  { to: '/teacher/gradebook',     icon: BookMarked,      label: 'Grade Book',     featureId: 'gradebook',                             tierFeature: 'lessons'   },
  { to: '/teacher/subjects',      icon: BookOpen,        label: 'Subjects',       featureId: 'subjects'                                      },
  { to: '/teacher/prizes',        icon: Gift,            label: 'Prizes',         featureId: 'prizes',                                tierFeature: 'prizes'    },
  { to: '/teacher/room-bookings', icon: DoorOpen,        label: 'Bookings',       featureId: 'booking',      showBooking: true,       tierFeature: 'booking'   },
  { to: '/teacher/chat',          icon: MessageSquare,   label: 'Chat',           featureId: 'chat',         showUnread: true,        tierFeature: 'chat'      },
  { to: '/teacher/production',    icon: Clapperboard,    label: 'Production',     featureId: 'production',                            tierFeature: 'production' },
  { to: '/teacher/resources',     icon: BookMarked,      label: 'Resources',      featureId: 'resources',                             tierFeature: 'resources' },
  { to: '/teacher/videos',        icon: Video,           label: 'Videos',         featureId: 'videos',                                tierFeature: 'video_lab' },
  { to: '/teacher/guide',         icon: BookOpen,        label: 'School Guide',   featureId: 'guide',                                 tierFeature: 'faq'       },
  { to: '/teacher/semester-wheel',icon: CircleDot,       label: 'Semester Wheel', featureId: 'semesterWheel',                         tierFeature: 'semester'  },
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
  const videoLabEnabled    = useFeature('video_lab')
  const canProduction      = useFeature('production')
  const canPrizes          = useFeature('prizes')
  const canBooking         = useFeature('booking')
  const canChat            = useFeature('chat')
  const canResources       = useFeature('resources')
  const canAssignments     = useFeature('assignments')
  const canLessons         = useFeature('lessons')
  const canSemester        = useFeature('semester')
  const canFaq             = useFeature('faq')

  const tierMap: Record<string, boolean> = {
    production: canProduction,
    prizes:     canPrizes,
    booking:    canBooking,
    chat:       canChat,
    resources:  canResources,
    assignments: canAssignments,
    lessons:    canLessons,
    video_lab:  videoLabEnabled,
    semester:   canSemester,
    faq:        canFaq,
  }

  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { data: navVis } = useDocument<{ id: string; teacher: Record<string, boolean>; customLinks?: { id: string; label: string; url: string; roles: string[] }[] }>('settings', 'nav_visibility')
  const filteredNav = useMemo(
    () => NAV.filter(item => {
      if (item.featureId && navVis?.teacher?.[item.featureId] === false) return false
      if (item.tierFeature && tierMap[item.tierFeature] === false) return false
      return true
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navVis, canProduction, canPrizes, canBooking, canChat, canResources,
     canAssignments, canLessons, videoLabEnabled, canSemester, canFaq],
  )

  const isChatPage  = pathname.endsWith('/chat')
  const isVideoPage = /\/videos\/[^/]+$/.test(pathname)
  const isGuidePage = pathname.endsWith('/guide')

  const chatUnread      = useChatUnreadCount()
  const bookingBadge    = useBookingBadge()
  const bookingDetail   = useBookingBadgeDetail()
  const calendarBadge   = useCalendarInviteBadge()
  const totalBadge      = chatUnread + bookingBadge + calendarBadge
  useAppBadge(totalBadge)

  const canSwitchToAdmin = role === 'admin'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <>
        {filteredNav.map(({ to, icon: Icon, label, showUnread, showBooking, showCalendarBadge, showEquipmentBadge, exact }) => (
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
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5',
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
                {showCalendarBadge && calendarBadge > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold px-1 leading-none">
                    {calendarBadge}
                  </span>
                )}
                {showEquipmentBadge && bookingDetail.equipment > 0 && (
                  <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1 leading-none">
                    {bookingDetail.equipment}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
        {videoLabEnabled && navVis?.teacher?.['videoLab'] !== false && <NavLink
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

        {/* Custom external links */}
        {(navVis?.customLinks ?? []).filter(l => l.roles.includes('teacher')).map(link => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onNavigate}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
          >
            <ExternalLink className="w-5 h-5 flex-shrink-0 text-zinc-500" />
            <span className="flex-1">{link.label}</span>
            <ExternalLink className="w-3 h-3 text-zinc-600 flex-shrink-0" />
          </a>
        ))}
      </>
    )
  }

  const SidebarFooter = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="p-3 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
      {canSwitchToAdmin && (
        <button
          onClick={() => { navigate('/admin'); onNavigate?.() }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all"
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
          <p className="text-sm font-medium text-zinc-100 truncate">{profile?.displayName}</p>
          <p className="text-xs text-zinc-500 truncate">Teacher</p>
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
    <AttendanceProvider>
    <CompleteProfileGate>
    <div className="flex overflow-hidden" style={{ height: '100dvh', background: 'var(--bg-primary)' }}>

      {/* ── Mobile top header ──────────────────────────────────────────────── */}
      <header className="mobile-header lg:hidden fixed top-0 left-0 right-0 z-40 border-b" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="h-14 flex items-center justify-between px-4">
          <Link to="/teacher" className="flex items-center gap-2.5">
            <img src={firePng} alt="CineForge" className="w-7 h-7 object-contain" />
            <div>
              <span className="text-sm font-bold text-zinc-100 tracking-tight leading-none block">{shortName}</span>
              <span className="text-[10px] text-zinc-400 leading-none">Teacher Portal</span>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationInbox />
            <button
              onClick={() => setDrawerOpen(true)}
              className="relative p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
            >
              <Menu className="w-5 h-5" />
              {totalBadge > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold px-1 leading-none">
                  {totalBadge > 99 ? '99+' : totalBadge}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile drawer overlay ──────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 flex flex-col shadow-2xl" style={{ background: 'var(--bg-surface)', paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="h-14 flex items-center justify-between px-5 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
              <Link to="/teacher" onClick={() => setDrawerOpen(false)} className="flex items-center gap-2.5">
                <img src={firePng} alt="CineForge" className="w-7 h-7 object-contain" />
                <div>
                  <span className="text-sm font-bold text-zinc-100 block leading-none">{shortName}</span>
                  <span className="text-[10px] text-zinc-400 leading-none">Teacher Portal</span>
                </div>
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
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
          <Link to="/teacher" className="flex items-center gap-3 flex-1 min-w-0">
            <img src={firePng} alt="CineForge" className="w-8 h-8 object-contain flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-base font-bold text-zinc-100 tracking-tight">{shortName}</span>
              <span className="block text-xs text-zinc-400 -mt-0.5">Teacher Portal</span>
            </div>
          </Link>
          <NotificationInbox />
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
        <Suspense fallback={
          <div className="p-8">
            <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse mb-2" />
            <div className="h-4 w-64 bg-white/5 rounded animate-pulse mb-8" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/5 rounded-xl mb-3 animate-pulse" />
            ))}
          </div>
        }>
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
        </Suspense>
      </main>
      <AttendanceOverlay />
    </div>
    </CompleteProfileGate>
    </AttendanceProvider>
  )
}
