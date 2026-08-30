import { useEffect, useRef, useState, Suspense } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Users, GraduationCap, Eye, LogOut, ArrowLeftRight, Clock,
  CalendarCheck, MessageSquare, BookOpen, Share2, BookMarked, Film, Menu, X,
  UtensilsCrossed, Car, Mail, SlidersHorizontal, ChevronDown, CircleDot, Tv, Shield, Package, ArchiveRestore, ClipboardList, BarChart2, RefreshCw, ArrowDown, Bug as BugIcon,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSchool } from '@/contexts/SchoolContext'
import { useFeature, useTier } from '@/hooks/useFeature'
import { useProductType } from '@/hooks/useProductType'
import { cn } from '@/lib/utils'
import Avatar from '@/components/common/Avatar'
import firePng from '@/assets/fire.png'
import { useBookingBadge, useBookingBadgeDetail } from '@/hooks/useBookingBadge'
import { useChatUnreadCount } from '@/hooks/useChatUnread'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { useAppBadge } from '@/hooks/useAppBadge'
import NotificationPermissionBanner from '@/components/NotificationPermissionBanner'
import OfflineBanner from '@/components/OfflineBanner'
import NotificationInbox from '@/components/NotificationInbox'
import BugReportButton from '@/components/BugReportButton'

interface NavItem { to: string; icon: React.ComponentType<{ className?: string }>; label: string; showBadge?: boolean; showUnread?: boolean }
interface NavGroup { id: string; label: string; icon: string; items: NavItem[]; defaultOpen?: boolean }

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'school', label: 'School', icon: '🏫', defaultOpen: true,
    items: [
      { to: '/admin/school-info', icon: Clock,        label: 'School Info'             },
      { to: '/admin/guide',       icon: BookMarked,   label: 'School Guide'            },
      { to: '/admin/chat',        icon: MessageSquare, label: 'Chat', showUnread: true  },
    ],
  },
  {
    id: 'people', label: 'People', icon: '👥', defaultOpen: true,
    items: [
      { to: '/admin/users',   icon: Users,        label: 'Users'   },
      { to: '/admin/cohorts', icon: GraduationCap, label: 'Classes' },
    ],
  },
  {
    id: 'academic', label: 'Academic', icon: '📚', defaultOpen: true,
    items: [
      { to: '/admin/lessons',           icon: BookOpen,    label: 'Lessons'          },
      { to: '/admin/semester-events',   icon: CircleDot,   label: 'Semester Wheel'   },
      { to: '/admin/qr-devices',        icon: Tv,          label: 'Check-in Devices' },
      { to: '/admin/production-roles',   icon: Film,        label: 'Production'        },
      { to: '/admin/experience-levels',  icon: BarChart2,   label: 'Experience Levels' },
    ],
  },
  {
    id: 'booking', label: 'Booking', icon: '📦', defaultOpen: false,
    items: [
      { to: '/admin/bookings',    icon: CalendarCheck,   label: 'Room Booking'                        },
      { to: '/admin/minivan',     icon: Car,             label: 'Vehicles',        showBadge: true   },
      { to: '/admin/food-box-orders', icon: UtensilsCrossed, label: 'Food Box Orders', showBadge: true   },
      { to: '/admin/equipment',   icon: Package,         label: 'Equipment',       showBadge: true   },
      { to: '/admin/inventory',   icon: ArchiveRestore,  label: 'Inventory'                          },
    ],
  },
  {
    id: 'settings', label: 'Settings', icon: '⚙️', defaultOpen: false,
    items: [
      { to: '/admin/email-config', icon: Mail,             label: 'Email Config' },
      { to: '/admin/sharepoint',   icon: Share2,           label: 'SharePoint'   },
      { to: '/admin/calendar-sync', icon: RefreshCw,       label: 'Calendar Sync' },
      { to: '/admin/nav-settings', icon: SlidersHorizontal, label: 'Nav Settings' },
      { to: '/admin/gdpr',         icon: Shield,           label: 'GDPR'         },
      { to: '/admin/bug-reports',  icon: BugIcon,          label: 'Bug Reports'  },
    ],
  },
]

export function AdminLayoutSkeleton() {
  return (
    <div className="flex h-screen bg-zinc-950">
      <div className="hidden lg:flex w-64 bg-zinc-900 border-r border-white/8 flex-col p-4 flex-shrink-0">
        <div className="flex items-center gap-2 mb-8 px-2">
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 animate-pulse" />
          <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-9 bg-white/5 rounded-xl mb-1 animate-pulse" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
      <div className="flex-1 p-8">
        <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse mb-2" />
        <div className="h-4 w-64 bg-white/5 rounded animate-pulse mb-8" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-white/5 rounded-xl mb-3 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function AdminContentSkeleton() {
  return (
    <div className="p-8">
      <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse mb-2" />
      <div className="h-4 w-64 bg-white/5 rounded animate-pulse mb-8" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 bg-white/5 rounded-xl mb-3 animate-pulse" />
      ))}
    </div>
  )
}

export default function AdminLayout() {
  const { profile, roles, signOut, setPreviewCohortId } = useAuth()
  const { shortName } = useSchool()
  const videoLabEnabled     = useFeature('video_lab')
  const canCheckinDevices   = useFeature('checkin_devices')
  const canEquipment        = useFeature('equipment')
  const canInventory        = useFeature('inventory')
  const canBooking          = useFeature('booking')
  const canVehicles         = useFeature('vehicles')
  const canFoodBox          = useFeature('food_box')
  const { tier }            = useTier()
  const productType         = useProductType()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { mainRef, indicatorRef } = usePullToRefresh(
    () => window.location.reload(),
  )
  const isChatPage          = pathname.endsWith('/chat')
  const isFullPage          = pathname === '/admin/equipment' || pathname === '/admin/inventory'
  const canSwitchToTeacher  = roles.includes('teacher')

  const chatUnread    = useChatUnreadCount()
  const bookingBadge  = useBookingBadge()
  const bookingDetail = useBookingBadgeDetail()
  const totalBadge    = chatUnread + bookingBadge
  useAppBadge(totalBadge)

  useEffect(() => { setPreviewCohortId(null) }, [])
  useEffect(() => {
    setDrawerOpen(false)
    mainRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    const STORAGE_KEY = 'adminNavGroups'
    const defaultOpen = Object.fromEntries(NAV_GROUPS.map(g => [g.id, g.defaultOpen ?? false]))
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
      try { return { ...defaultOpen, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } }
      catch { return defaultOpen }
    })

    function toggle(id: string) {
      setOpenGroups(prev => {
        const next = { ...prev, [id]: !prev[id] }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        return next
      })
    }

    const ROUTE_FEATURE_GATE: Record<string, boolean> = {
      '/admin/qr-devices':        canCheckinDevices,
      '/admin/equipment':         canEquipment,
      '/admin/inventory':         canInventory,
      '/admin/bookings':          canBooking,
      '/admin/minivan':           canVehicles,
      '/admin/food-box-orders':   canFoodBox,
    }

    // Rental mode: show only equipment-related nav items
    if (productType === 'rental') {
      const rentalNavItems = [
        { to: '/admin/equipment', icon: Package, label: 'Equipment' },
        { to: '/admin/inventory', icon: ArchiveRestore, label: 'Inventory' },
      ]
      return (
        <div className="space-y-0.5">
          {rentalNavItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                isActive ? 'bg-rose-700 text-white' : 'text-zinc-400 hover:bg-[var(--bg-elevated)] hover:text-white',
              )}
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('w-4 h-4 flex-shrink-0', isActive ? 'text-white' : 'text-zinc-500')} />
                  <span className="flex-1">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      )
    }

    return (
      <div className="space-y-1">
        {NAV_GROUPS.map(group => {
          const visibleItems = group.items.filter(item => ROUTE_FEATURE_GATE[item.to] !== false)
          if (visibleItems.length === 0) return null
          return (
          <div key={group.id}>
            <button
              onClick={() => toggle(group.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <span className="text-xs">{group.icon}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider flex-1 text-left">{group.label}</span>
              <ChevronDown className={cn('w-3 h-3 transition-transform', openGroups[group.id] ? 'rotate-0' : '-rotate-90')} />
            </button>
            {openGroups[group.id] && (
              <div className="space-y-0.5 mb-1">
                {visibleItems.map(({ to, icon: Icon, label, showBadge, showUnread }) => {
                  const badgeCount = showBadge
                    ? (to === '/admin/food-box-orders' ? bookingDetail.food : to === '/admin/equipment' ? bookingDetail.equipment : bookingDetail.van)
                    : showUnread ? chatUnread : 0
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={onNavigate}
                      className={({ isActive }) => cn(
                        'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ml-2',
                        isActive ? 'bg-rose-700 text-white' : 'text-zinc-400 hover:bg-[var(--bg-elevated)] hover:text-white',
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={cn('w-4 h-4 flex-shrink-0', isActive ? 'text-white' : 'text-zinc-500')} />
                          <span className="flex-1">{label}</span>
                          {badgeCount > 0 && (
                            <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-brand-500 text-white text-[10px] font-bold px-1 leading-none">{badgeCount}</span>
                          )}
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            )}
          </div>
        )
        })}

        {/* Video Lab — standalone amber item */}
        {videoLabEnabled && <NavLink
          to="/admin/video-lab"
          onClick={onNavigate}
          className={({ isActive }) => cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
            isActive ? 'bg-amber-500/20 text-amber-300' : 'text-amber-400 hover:bg-amber-900/20 hover:text-amber-300',
          )}
        >
          {({ isActive }) => (
            <>
              <Film className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-amber-300' : 'text-amber-500')} />
              <span className="flex-1">Video Lab 🎬</span>
              <span className="text-[10px] font-bold bg-amber-900/30 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-700/40 leading-none">Beta</span>
            </>
          )}
        </NavLink>}

        {/* Student Preview — standalone */}
        <NavLink
          to="/admin/preview"
          onClick={onNavigate}
          className={({ isActive }) => cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
            isActive ? 'bg-rose-700 text-white' : 'text-zinc-400 hover:bg-[var(--bg-elevated)] hover:text-white',
          )}
        >
          {({ isActive }) => (
            <>
              <Eye className={cn('w-5 h-5 flex-shrink-0', isActive ? 'text-white' : 'text-zinc-500')} />
              <span className="flex-1">Student Preview</span>
            </>
          )}
        </NavLink>
      </div>
    )
  }

  const TIER_PILL_COLORS: Record<string, string> = {
    studio:  'bg-orange-500/20 text-orange-400',
    academy: 'bg-purple-500/20 text-purple-400',
    campus:  'bg-blue-500/20   text-blue-400',
  }

  const SidebarFooter = () => {
    const { storageUsedBytes = 0, storageQuotaGB } = useSchool()
    const storageQuotaPct = storageQuotaGB
      ? Math.min(100, Math.round((storageUsedBytes / (storageQuotaGB * 1024 * 1024 * 1024)) * 100))
      : 0
    const storageBarColor = storageQuotaPct > 90 ? 'bg-rose-500' : storageQuotaPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
    function fmtB(b: number) {
      return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.round(b / 1024)} KB`
    }
    return (
      <div className="p-3 border-t border-[var(--border)] space-y-1">
        {tier && (
          <div className={`mx-0 mb-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-center ${TIER_PILL_COLORS[tier] ?? 'bg-white/10 text-zinc-400'}`}>
            {tier.charAt(0).toUpperCase() + tier.slice(1)} Plan
          </div>
        )}
        {storageQuotaGB && (
          <div className="mx-0 mb-1 px-3 py-2 rounded-xl bg-white/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-zinc-400 font-medium">Storage</span>
              <span className="text-[10px] text-zinc-500">{fmtB(storageUsedBytes)} / {storageQuotaGB} GB</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${storageBarColor}`} style={{ width: `${storageQuotaPct}%` }} />
            </div>
          </div>
        )}
        {canSwitchToTeacher && (
          <button
            onClick={() => navigate('/teacher')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:bg-[var(--bg-elevated)] hover:text-white transition-all"
          >
            <ArrowLeftRight className="w-4 h-4" />
            Switch to Teacher view
          </button>
        )}
        <div className="flex items-center gap-3 px-3 py-2">
          <Avatar uid={profile?.uid ?? 'x'} name={profile?.displayName ?? '?'} avatarUrl={profile?.avatarUrl} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{profile?.displayName}</p>
            <p className="text-xs text-rose-400 truncate">Admin</p>
          </div>
          <button
            onClick={handleSignOut}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[var(--bg-hover)] transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="flex" style={{ height: '100dvh', background: 'var(--bg-primary)', overflow: 'clip' }}>
      <OfflineBanner />

      {/* ── Mobile top header ──────────────────────────────────────────────── */}
      <header className="mobile-header lg:hidden fixed top-0 left-0 right-0 z-40 bg-[var(--bg-surface)] border-b border-[var(--border)] shadow-lg">
        <div className="h-14 flex items-center justify-between px-4">
          <Link to="/admin/users" className="flex items-center gap-2.5">
            <img src={firePng} alt="CineForge" className="w-7 h-7 object-contain" />
            <div>
              <span className="text-sm font-bold text-white tracking-tight leading-none block">{shortName}</span>
              <span className="text-[10px] text-rose-400 leading-none">Admin Portal</span>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            <BugReportButton />
            <NotificationInbox />
            <button
              onClick={() => setDrawerOpen(true)}
              className="relative p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-[var(--bg-elevated)] transition-colors"
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
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-[var(--bg-surface)] flex flex-col shadow-2xl">
            <div className="h-14 flex items-center justify-between px-5 border-b border-[var(--border)] flex-shrink-0">
              <Link to="/admin/users" onClick={() => setDrawerOpen(false)} className="flex items-center gap-2.5">
                <img src={firePng} alt="CineForge" className="w-7 h-7 object-contain" />
                <div>
                  <span className="text-sm font-bold text-white block leading-none">{shortName}</span>
                  <span className="text-[10px] text-rose-400 leading-none">Admin Portal</span>
                </div>
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              <NavLinks onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <SidebarFooter />
          </aside>
        </div>
      )}

      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-64 bg-[var(--bg-surface)] flex-col shadow-xl flex-shrink-0">
        <div className="h-16 flex items-center gap-3 px-5 border-b border-[var(--border)]">
          <Link to="/admin/users" className="flex items-center gap-3 flex-1 min-w-0">
            <img src={firePng} alt="CineForge" className="w-8 h-8 object-contain flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-base font-bold text-white tracking-tight">{shortName}</span>
              <span className="block text-xs text-rose-400 -mt-0.5">Admin Portal</span>
            </div>
          </Link>
          <BugReportButton />
          <NotificationInbox />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <NavLinks />
        </nav>
        <SidebarFooter />
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main
        ref={mainRef}
        className={cn(
          'flex-1 pt-header lg:pt-0',
          isChatPage ? 'overflow-hidden flex flex-col' : 'overflow-y-auto',
        )}
      >
        <NotificationPermissionBanner />
        <Suspense fallback={<AdminContentSkeleton />}>
          {isChatPage ? (
            <Outlet key={pathname} />
          ) : isFullPage ? (
            <Outlet key={pathname} />
          ) : (
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="max-w-6xl mx-auto px-4 py-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8"
            >
              <Outlet />
            </motion.div>
          )}
        </Suspense>
      </main>
    </div>

      {/* ── Pull-to-refresh indicator ─────────────────────────────────────── */}
      <div
        ref={indicatorRef}
        className="lg:hidden fixed left-0 right-0 z-30 items-center justify-center pointer-events-none"
        style={{ top: 'calc(4rem + env(safe-area-inset-top, 0px))', display: 'none', opacity: 0, height: '52px' }}
      >
        <div data-pull-circle className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg border border-zinc-700 bg-zinc-800 transition-colors">
          <ArrowDown data-pull-arrow className="w-5 h-5 text-zinc-300" style={{ transition: 'transform 80ms linear' }} />
        </div>
      </div>
    </>
  )
}
