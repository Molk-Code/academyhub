import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, Calendar, BookOpen,
  Trophy, LogOut, ArrowLeft, QrCode, ClipboardList, DoorOpen,
  MessageSquare, Clapperboard, Film, FolderOpen, Menu, X, ListChecks, User, ChevronDown, CalendarRange, Package,
  Car, UtensilsCrossed,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSchool } from '@/contexts/SchoolContext'
import { useFeature } from '@/hooks/useFeature'
import { useDocument, useCollection, where, orderBy } from '@/hooks/useFirestore'
import { doc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { NotificationDoc } from '@/types'
import { cn } from '@/lib/utils'
import Avatar from '@/components/common/Avatar'
import { useChatUnreadCount } from '@/hooks/useChatUnread'
import { useBookingBadge } from '@/hooks/useBookingBadge'
import { useCalendarInviteBadge } from '@/hooks/useCalendarInviteBadge'
import type { Feature } from '@/lib/features'
import { useAppBadge } from '@/hooks/useAppBadge'
import { usePwaInstall } from '@/hooks/usePwaInstall'
import firePng from '@/assets/fire.png'
import { Download, ExternalLink } from 'lucide-react'
import CompleteProfileGate from '@/components/CompleteProfileGate'
import WelcomeModal from '@/components/WelcomeModal'
import NotificationPermissionBanner from '@/components/NotificationPermissionBanner'
import OfflineBanner from '@/components/OfflineBanner'
import NotificationInbox from '@/components/NotificationInbox'
import InstallPrompt from '@/components/InstallPrompt'

interface NavItem {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  showUnread?: boolean
  showBooking?: boolean
  showCalendarBadge?: boolean
  featureId?: string
  tierFeature?: Feature
  end?: boolean
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard',   featureId: 'dashboard'                                                        },
  { to: '/checkin',     icon: QrCode,          label: 'Check In',    featureId: 'checkin'                                                          },
  { to: '/calendar',    icon: Calendar,        label: 'Calendar',    featureId: 'calendar',    showCalendarBadge: true, tierFeature: 'calendar'    },
  { to: '/my-plan',     icon: ListChecks,      label: 'To-Do List',  featureId: 'myPlan',                               tierFeature: 'development_plan' },
  { to: '/semester',    icon: CalendarRange,   label: 'Semester',    featureId: 'semester',                             tierFeature: 'semester'    },
  { to: '/chat',        icon: MessageSquare,   label: 'Chat',        featureId: 'chat',        showUnread: true,        tierFeature: 'chat'        },
  { to: '/assignments', icon: ClipboardList,   label: 'Assignments', featureId: 'assignments',                          tierFeature: 'assignments' },
  { to: '/resources',   icon: FolderOpen,      label: 'Resources',   featureId: 'resources',                            tierFeature: 'resources'   },
  { to: '/guide',       icon: BookOpen,        label: 'School Guide', featureId: 'guide',                                tierFeature: 'faq'         },
]

function SidebarGroup({ label, icon, defaultOpen = false, children }: {
  label: string
  icon: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const key = `sidebar-group-${label.toLowerCase()}`
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== null ? localStorage.getItem(key) === 'true' : defaultOpen } catch { return defaultOpen }
  })
  function toggle() {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(key, String(next)) } catch {}
  }
  return (
    <>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-400 hover:bg-white/5 hover:text-zinc-100 transition-all"
      >
        <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-base">{icon}</span>
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown className={cn('w-4 h-4 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="ml-3 pl-3 border-l border-white/8 space-y-0.5">
          {children}
        </div>
      )}
    </>
  )
}

export function StudentLayoutSkeleton() {
  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="hidden lg:flex w-64 flex-col flex-shrink-0 border-r" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="h-16 flex items-center gap-3 px-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-8 h-8 rounded-lg bg-brand-500/20 animate-pulse flex-shrink-0" />
          <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
        </div>
        <div className="flex-1 px-3 py-4 space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 bg-white/5 rounded-xl animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      </div>
      <div className="flex-1 p-8">
        <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse mb-2" />
        <div className="h-4 w-64 bg-white/5 rounded animate-pulse mb-8" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-white/5 rounded-xl mb-3 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function StudentContentSkeleton() {
  return (
    <div className="p-8">
      <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse mb-2" />
      <div className="h-4 w-64 bg-white/5 rounded animate-pulse mb-8" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 bg-white/5 rounded-xl mb-3 animate-pulse" />
      ))}
    </div>
  )
}

export default function StudentLayout() {
  const { profile, role, signOut } = useAuth()
  const { shortName } = useSchool()
  const canProduction   = useFeature('production')
  const canEquipment    = useFeature('equipment')
  const canBooking      = useFeature('booking')
  const canVehicles     = useFeature('vehicles')
  const canFoodBox      = useFeature('food_box')
  const canResources    = useFeature('resources')
  const canPrizes       = useFeature('prizes')
  const canVideoLab     = useFeature('video_lab')
  const canCalendar     = useFeature('calendar')
  const canChat         = useFeature('chat')
  const canAssignments  = useFeature('assignments')
  const canSemester     = useFeature('semester')
  const canDevPlan      = useFeature('development_plan')
  const canFaq          = useFeature('faq')
  const videoLabSchool  = canVideoLab

  const tierFeatureMap: Record<string, boolean> = {
    calendar: canCalendar,
    development_plan: canDevPlan,
    semester: canSemester,
    chat: canChat,
    assignments: canAssignments,
    resources: canResources,
    faq: canFaq,
  }
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen,    setDrawerOpen]    = useState(false)
  const isChatPage     = pathname.endsWith('/chat')
  const isVideoPage    = /\/videos\/[^/]+$/.test(pathname)
  const isFullPage     = pathname === '/booking/equipment'
  const isGuidePage    = pathname.endsWith('/guide')
  const isAdminPreview = role === 'admin'
  const chatUnread     = useChatUnreadCount()
  const bookingBadge   = useBookingBadge()
  const calendarBadge  = useCalendarInviteBadge()
  const totalBadge     = chatUnread + bookingBadge + calendarBadge
  useAppBadge(totalBadge)
  const { canInstall, install } = usePwaInstall()

  const { data: navVis } = useDocument<{ id: string; student: Record<string, boolean>; customLinks?: { id: string; label: string; url: string; roles: string[] }[] }>('settings', 'nav_visibility')
  const { data: schoolDoc } = useDocument<{ id: string; name?: string }>('settings', 'school')
  const schoolName = schoolDoc?.name ?? ''

  // Level-up notifications
  const { data: levelUpNotifs } = useCollection<NotificationDoc>(
    'notifications',
    profile?.uid
      ? [where('uid', '==', profile.uid), where('type', '==', 'level_up'), where('isRead', '==', false)]
      : [],
    !!profile?.uid,
  )
  const [congratsLevel, setCongratsLevel] = useState<string | null>(null)

  useEffect(() => {
    if (levelUpNotifs && levelUpNotifs.length > 0) {
      // Show the most recently earned level (highest pointsRequired would be ideal, but we just show the newest)
      const newest = [...levelUpNotifs].sort((a, b) =>
        (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
      )[0]
      setCongratsLevel(newest.levelName ?? newest.title)
    }
  }, [levelUpNotifs?.length])

  const dismissCongrats = useCallback(async () => {
    setCongratsLevel(null)
    if (!levelUpNotifs?.length) return
    const batch = writeBatch(db)
    for (const n of levelUpNotifs) {
      batch.update(doc(db, 'notifications', n.id), { isRead: true })
    }
    await batch.commit()
  }, [levelUpNotifs])

  const primaryNav = useMemo(
    () => PRIMARY_NAV.filter(item => {
      if (item.featureId && navVis?.student?.[item.featureId] === false) return false
      if (item.tierFeature && tierFeatureMap[item.tierFeature] === false) return false
      return true
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navVis, canCalendar, canChat, canAssignments, canSemester, canDevPlan, canResources, canFaq],
  )

  const videoLabEnabled = videoLabSchool && navVis?.student?.['videoLab'] !== false

  const showCalendar = navVis?.student?.calendar !== false
  const showChat     = navVis?.student?.chat     !== false
  const showBooking  = navVis?.student?.booking  !== false


  useEffect(() => { setDrawerOpen(false) }, [pathname])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function NavItem({ to, icon: Icon, label, showUnread: su, showBooking: sb, showCalendarBadge: sc, end, onNavigate }: NavItem & { onNavigate?: () => void }) {
    return (
      <NavLink
        to={to}
        end={end}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
            isActive ? 'bg-brand-500/15 text-brand-400' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-brand-400' : 'text-zinc-500')} />
            <span className="flex-1">{label}</span>
            {su && chatUnread > 0 && (
              <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold px-1 leading-none">{chatUnread}</span>
            )}
            {sb && bookingBadge > 0 && (
              <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1 leading-none">{bookingBadge}</span>
            )}
            {sc && calendarBadge > 0 && (
              <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-bold px-1 leading-none">{calendarBadge}</span>
            )}
          </>
        )}
      </NavLink>
    )
  }

  function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    const vis = navVis?.student
    return (
      <>
        {primaryNav.map(item => <NavItem key={item.to} {...item} onNavigate={onNavigate} />)}

        {/* Subjects — standalone, always visible */}
        {vis?.['subjects'] !== false && <NavItem to="/subjects" icon={BookOpen} label="Subjects" onNavigate={onNavigate} />}

        {/* Create group — only render if at least one item is visible */}
        {(canProduction && vis?.['production'] !== false) || (canVideoLab && videoLabEnabled) ? (
          <SidebarGroup label="Create" icon="🎬" defaultOpen={false}>
            {canProduction && vis?.['production'] !== false && <NavItem to="/production" icon={Clapperboard} label="Production" onNavigate={onNavigate} />}
            {canVideoLab && videoLabEnabled && (
              <NavLink
                to="/video-lab"
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                    isActive ? 'bg-amber-500/20 text-amber-300' : 'text-amber-400 hover:bg-amber-900/20 hover:text-amber-300',
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
              </NavLink>
            )}
          </SidebarGroup>
        ) : null}

        {/* Booking group — only render if at least one item is visible */}
        {(canBooking && vis?.['booking'] !== false) || (canEquipment && vis?.['equipment'] !== false) || (canVehicles && vis?.['vehicles'] !== false) || (canFoodBox && vis?.['foodBoxes'] !== false) ? (
          <SidebarGroup label="Booking" icon="📦" defaultOpen={false}>
            {canBooking   && vis?.['booking']   !== false && <NavItem to="/booking"           icon={DoorOpen}       label="Room Booking" showBooking end onNavigate={onNavigate} />}
            {canEquipment && vis?.['equipment'] !== false && <NavItem to="/booking/equipment" icon={Package}         label="Equipment"    onNavigate={onNavigate} />}
            {canVehicles  && vis?.['vehicles']  !== false && <NavItem to="/vehicles"          icon={Car}             label="Vehicles"     onNavigate={onNavigate} />}
            {canFoodBox   && vis?.['foodBoxes'] !== false && <NavItem to="/food-boxes"        icon={UtensilsCrossed} label="Food Boxes"   onNavigate={onNavigate} />}
          </SidebarGroup>
        ) : null}

        {/* Prizes */}
        {canPrizes && vis?.['prizes'] !== false && <NavItem to="/prizes" icon={Trophy} label="Prizes" onNavigate={onNavigate} />}

        {/* Custom external links */}
        {(navVis?.customLinks ?? []).filter(l => l.roles.includes('student')).map(link => (
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

  const UserFooter = ({ onNavigate }: { onNavigate?: () => void }) => {
    return (
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
        {navVis?.student?.['profile'] === false ? (
          <div className="flex items-center justify-between px-3 py-2 gap-3">
            <p className="text-xs text-zinc-500 truncate">{profile?.email}</p>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-white/10 transition-colors flex-shrink-0"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
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
        )}
      </div>
    )
  }

  return (
    <CompleteProfileGate>
    <div className="flex overflow-hidden" style={{ height: '100dvh', background: 'var(--bg-primary)' }}>
      <OfflineBanner />

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
          <div className="flex items-center gap-1">
            <NotificationInbox />
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 rounded-xl text-zinc-400 hover:bg-white/10 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile drawer overlay ──────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 flex flex-col shadow-2xl" style={{ background: 'var(--bg-surface)', paddingTop: 'env(safe-area-inset-top)' }}>
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
          <Link to="/dashboard" className="flex items-end gap-3 overflow-hidden flex-1 min-w-0">
            <img src={firePng} alt="CineForge" className="w-8 h-8 object-contain flex-shrink-0" />
            <div className="overflow-hidden">
              <p className="text-base font-bold text-zinc-100 tracking-tight leading-none">{shortName}</p>
              {schoolName && <p className="text-[9px] text-zinc-500 tracking-tight mt-[3px] leading-none whitespace-nowrap overflow-hidden text-ellipsis">{schoolName}</p>}
            </div>
          </Link>
          <NotificationInbox />
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
        <InstallPrompt />

        {/* Level-up congratulations modal */}
        {congratsLevel && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={dismissCongrats}>
            <div
              className="bg-zinc-900 border border-amber-500/30 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-20 h-20 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center mx-auto text-4xl">
                🏆
              </div>
              <div>
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-widest mb-1">Level up!</p>
                <h2 className="text-2xl font-bold text-zinc-100">{congratsLevel}</h2>
                <p className="text-zinc-400 text-sm mt-2">You've reached a new experience level. Keep earning points to unlock more!</p>
              </div>
              <button
                onClick={dismissCongrats}
                className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-900 font-bold py-3 rounded-2xl transition-colors"
              >
                Awesome!
              </button>
            </div>
          </div>
        )}
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
        <Suspense fallback={<StudentContentSkeleton />}>
          {(isChatPage || isVideoPage) ? (
            <Outlet />
          ) : isFullPage ? (
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
        </Suspense>
      </main>

      {/* ── Mobile bottom tab bar ──────────────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-stretch h-12">
          {/* Home */}
          {navVis?.student?.['dashboard'] !== false && (
          <NavLink to="/dashboard" className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-zinc-500',
          )}>
            {({ isActive }) => (<>
              <LayoutDashboard className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
              <span>Home</span>
            </>)}
          </NavLink>
          )}
          {/* Calendar */}
          {navVis?.student?.['calendar'] !== false && (
            <NavLink to="/calendar" className={({ isActive }) => cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-brand-400' : 'text-zinc-500',
            )}>
              {({ isActive }) => (<>
                <div className="relative">
                  <Calendar className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
                  {calendarBadge > 0 && (
                    <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-full bg-brand-500 text-white text-[8px] font-bold px-0.5 leading-none">
                      {calendarBadge > 9 ? '9+' : calendarBadge}
                    </span>
                  )}
                </div>
                <span>Calendar</span>
              </>)}
            </NavLink>
          )}
          {/* Check In */}
          {navVis?.student?.['checkin'] !== false && (
            <NavLink to="/checkin" className={({ isActive }) => cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-brand-400' : 'text-zinc-500',
            )}>
              {({ isActive }) => (<>
                <QrCode className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
                <span>Check In</span>
              </>)}
            </NavLink>
          )}
          {/* Chat */}
          {navVis?.student?.['chat'] !== false && (
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
          )}
          {/* Profile */}
          {navVis?.student?.['profile'] !== false && (
          <NavLink to="/profile" className={({ isActive }) => cn(
            'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
            isActive ? 'text-brand-400' : 'text-zinc-500',
          )}>
            {({ isActive }) => (<>
              <User className={cn('w-5 h-5', isActive ? 'text-brand-400' : 'text-zinc-500')} />
              <span>Profile</span>
            </>)}
          </NavLink>
          )}
        </div>
      </nav>
      <WelcomeModal />
    </div>
    </CompleteProfileGate>
  )
}
