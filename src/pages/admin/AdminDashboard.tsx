import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import {
  Package, ArchiveRestore, Bug, Inbox, RefreshCw, UtensilsCrossed, Car, CalendarDays, UserX,
  AlertTriangle, PenLine, Wrench, CheckCircle2, Users, GraduationCap, Plus, ScanLine, HelpCircle,
} from 'lucide-react'
import { useProjectItems } from '@/components/equipment/ContractSignPanel'
import { unitsSummary } from '@/pages/equipment/InventoryCounter'
import { toneChip, type StatusTone } from '@/lib/statusTone'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import { useFeature } from '@/hooks/useFeature'
import { useModuleGate } from '@/hooks/useModules'
import { useAllUsers } from '@/hooks/useAllUsers'
import { useCalendarSyncAlert } from '@/hooks/useCalendarSyncAlert'
import { cn } from '@/lib/utils'
import { localDate, equipmentOut, pickupsToday, daysOverdue } from '@/lib/adminDashboard'
import type { EquipmentBookingDoc, InventoryProjectDoc, FoodBoxOrderDoc, MinivanBookingDoc, LessonDoc, AbsenceReportDoc, EquipmentDoc } from '@/types'
import { needsService } from '@/lib/maintenance'
import { useCohorts } from '@/lib/queries'
import { PlanUsage } from '@/components/admin/PlanNotices'
import { usePlan } from '@/hooks/usePlan'

interface BugReport { id: string; status: string; description: string; displayName: string; page: string; createdAt?: Timestamp }
interface ContactRequest { id: string; status: string; name: string; organisation: string | null; message: string; createdAt?: Timestamp }

const newestFirst = <T extends { createdAt?: Timestamp }>(a: T, b: T) =>
  (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)

function greeting(h: number) {
  return h < 10 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

type Tone = 'missing' | 'danger' | 'warning' | 'info' | 'pending' | 'brand'
const TONE: Record<Tone, { border: string; text: string }> = {
  missing: { border: 'border-[#ff5449]',                text: 'text-[#ff5449]' },
  danger:  { border: 'border-[rgba(255,180,171,0.35)]', text: 'text-[#ffb4ab]' },
  warning: { border: 'border-[rgba(246,174,45,0.35)]',  text: 'text-[#f6ae2d]' },
  info:    { border: 'border-[rgba(180,197,255,0.3)]',  text: 'text-[#b4c5ff]' },
  pending: { border: 'border-[rgba(220,198,255,0.4)]',  text: 'text-[#dcc6ff]' },
  brand:   { border: 'border-brand-500/40',             text: 'text-brand-300' },
}

interface Attention {
  key: string; to: string; icon: React.ComponentType<{ className?: string }>
  /** Short name, used in the "All clear" line */ label: string
  count: number; detail: string; tone: Tone
}

// Something that needs the admin: only shown as a card while its count is above zero
function ActionCard({ to, icon: Icon, label, count, detail, tone }: Attention) {
  const t = TONE[tone]
  return (
    <Link to={to} className={cn('rounded-2xl border bg-zinc-900 p-4 flex flex-col gap-2 transition-colors hover:bg-zinc-800', t.border)}>
      <span className={cn('inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide', t.text)}>
        <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {label}
      </span>
      <span className="font-display text-3xl font-bold text-zinc-50">{count}</span>
      <span className="text-sm text-zinc-300">{detail}</span>
    </Link>
  )
}

function Panel({ title, icon: Icon, to, linkLabel, children }: {
  title: string; icon: React.ComponentType<{ className?: string }>; to?: string; linkLabel?: string; children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900 p-4 space-y-3" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Icon className="w-4 h-4 text-brand-400" /> {title}
        </h2>
        {to && <Link to={to} className="text-xs text-brand-400 hover:text-brand-300">{linkLabel ?? 'View all'}</Link>}
      </div>
      {children}
    </section>
  )
}

const Quiet = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-zinc-500 flex items-center gap-1.5 py-2">
    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" /> {children}
  </p>
)

export default function AdminDashboard() {
  const { profile } = useAuth()
  const canEquipment = useFeature('equipment')
  const canInventory = useFeature('inventory')
  const canVehicles  = useFeature('vehicles')
  const canFoodBox   = useFeature('food_box')
  const plan = usePlan()
  const academy      = useModuleGate('academy')

  const now = new Date()
  const today = localDate(now)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayEnd = new Date(dayStart.getTime() + 86_400_000)

  const { data: bookings } = useCollection<EquipmentBookingDoc>('equipment_bookings',
    [where('status', 'in', ['pending', 'confirmed'])], canEquipment)
  const { data: projects } = useCollection<InventoryProjectDoc>('inventory_projects',
    [where('status', 'in', ['active', 'checked-out'])], canInventory)
  const { data: bugs } = useCollection<BugReport>('bug_reports', [where('status', '==', 'open')])
  const { data: contacts } = useCollection<ContactRequest>('contact_requests', [where('status', '==', 'new')])
  const { data: catalog } = useCollection<EquipmentDoc>('equipment', [], canEquipment)
  const serviceCount = needsService(catalog, today)
  const { data: food } = useCollection<FoodBoxOrderDoc>('food_box_orders', [where('status', '==', 'pending')], canFoodBox)
  const { data: vans } = useCollection<MinivanBookingDoc>('minivan_bookings', [where('status', '==', 'pending')], canVehicles)
  const { data: lessons } = useCollection<LessonDoc>('lessons', [
    where('startTime', '>=', Timestamp.fromDate(dayStart)),
    where('startTime', '<', Timestamp.fromDate(dayEnd)),
  ], academy, today)
  const { data: absences } = useCollection<AbsenceReportDoc>('absence_reports', [where('date', '==', today)], academy, today)
  const { data: cohorts } = useCohorts({ enabled: academy })
  const { data: users } = useAllUsers()
  const silentSyncs = useCalendarSyncAlert(academy)

  const pending = bookings.filter(b => b.status === 'pending').sort((a, b) => (a.checkoutDate ?? '').localeCompare(b.checkoutDate ?? ''))
  const pickups = pickupsToday(bookings, today)
  const eq = useMemo(() => equipmentOut(projects, today), [projects, today])
  // Units on the projects that are out: unit numbers per row, and missing ones
  const outItems = useProjectItems(eq.out.map(p => p.id))
  const missingUnits = outItems.filter(i => i.status === 'missing').length
  const openBugs = [...bugs].sort(newestFirst)
  const newContacts = [...contacts].sort(newestFirst)
  const people = useMemo(() => {
    const active = users.filter(u => u.isActive !== false)
    const has = (u: typeof users[number], r: string) => u.role === r || u.roles?.includes(r as never)
    return {
      students: active.filter(u => has(u, 'student')).length,
      teachers: active.filter(u => has(u, 'teacher')).length,
      admins: active.filter(u => has(u, 'admin')).length,
    }
  }, [users])

  const firstName = profile?.displayName?.split(' ')[0] ?? ''

  const attention: (Attention | false)[] = [
    canInventory && { key: 'missing', to: '/admin/inventory', icon: HelpCircle, label: 'Missing', count: missingUnits, tone: 'missing',
      detail: `${missingUnits === 1 ? 'unit is' : 'units are'} missing on projects still out` },
    canInventory && { key: 'overdue', to: '/admin/inventory', icon: AlertTriangle, label: 'Overdue', count: eq.overdue.length, tone: 'danger',
      detail: `${eq.overdue.length === 1 ? 'project is' : 'projects are'} past the return date` },
    canEquipment && { key: 'requests', to: '/admin/equipment?tab=bookings', icon: Package, label: 'Requests', count: pending.length, tone: 'warning',
      detail: `equipment ${pending.length === 1 ? 'request' : 'requests'} to answer` },
    canInventory && { key: 'signatures', to: '/admin/inventory', icon: PenLine, label: 'Signatures', count: eq.awaitingSignatures.length, tone: 'pending',
      detail: `${eq.awaitingSignatures.length === 1 ? 'project has' : 'projects have'} unsigned contracts` },
    canEquipment && plan.has('maintenance') && { key: 'service', to: '/admin/equipment?tab=maintenance', icon: Wrench, label: 'Service', count: serviceCount, tone: 'warning',
      detail: 'items in service or overdue for it' },
    { key: 'bugs', to: '/admin/bug-reports', icon: Bug, label: 'Bug reports', count: openBugs.length, tone: 'brand', detail: 'open, reported by users' },
    { key: 'contacts', to: '/admin/contact-requests', icon: Inbox, label: 'Contact requests', count: newContacts.length, tone: 'brand', detail: 'new, not handled' },
    canFoodBox && { key: 'food', to: '/admin/food-box-orders', icon: UtensilsCrossed, label: 'Food boxes', count: food.length, tone: 'brand', detail: 'orders waiting for approval' },
    canVehicles && { key: 'vans', to: '/admin/minivan', icon: Car, label: 'Vehicles', count: vans.length, tone: 'brand', detail: 'bookings waiting for approval' },
    academy && { key: 'sync', to: '/admin/calendar-sync', icon: RefreshCw, label: 'Calendar sync', count: silentSyncs, tone: 'warning', detail: 'Outlook syncs gone quiet' },
  ]
  const shown = attention.filter((a): a is Attention => !!a)
  const needs = shown.filter(a => a.count > 0)
  const clear = shown.filter(a => a.count === 0)

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-zinc-400 text-sm capitalize">
            {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <h1 className="page-title mt-1">{greeting(now.getHours())}{firstName && `, ${firstName}`}</h1>
        </div>
        {canInventory && (
          <div className="flex flex-wrap gap-2">
            <Link to="/scan" className="btn-secondary min-h-[44px]"><ScanLine className="w-4 h-4" aria-hidden="true" /> Phone scanner</Link>
            <Link to="/admin/inventory?new=1" className="btn-primary min-h-[44px]"><Plus className="w-4 h-4" aria-hidden="true" /> New project</Link>
          </div>
        )}
      </div>

      {/* ── Needs attention: cards for what has something, one line for the rest ── */}
      <section aria-labelledby="attention-title" className="space-y-3">
        <h2 id="attention-title" className="font-display text-base font-bold text-zinc-100">
          Needs your attention{needs.length > 0 && <span className="font-sans font-medium text-zinc-400"> · {needs.length}</span>}
        </h2>
        {needs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {needs.map(a => <ActionCard {...a} key={a.key} />)}
          </div>
        )}
        {clear.length > 0 && (
          <p className="text-sm text-zinc-400 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>All clear: {clear.map(a => a.label.toLowerCase()).join(', ')}.</span>
          </p>
        )}
      </section>

      <PlanUsage />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Equipment out ──────────────────────────────────────────────── */}
        {canInventory && (
          <Panel title={`Equipment out, by return date (${eq.out.length})`} icon={ArchiveRestore} to="/admin/inventory" linkLabel="Inventory">
            {eq.out.length === 0 ? <Quiet>Nothing is checked out.</Quiet> : (
              <ul className="divide-y divide-white/5">
                {eq.out.slice(0, 8).map(p => {
                  const late = daysOverdue(p.returnDate, today)
                  const items = outItems.filter(i => i.projectId === p.id && i.status !== 'returned')
                  const missing = items.filter(i => i.status === 'missing').length
                  const damaged = items.filter(i => i.status === 'damaged').length
                  const unsigned = (p.pendingSignatureUids?.length ?? 0) > 0
                  // The one flag a row shows, most urgent first (same colours as Inventory)
                  const flag: [StatusTone, string] | null =
                    missing ? ['missing', `${missing} missing`]
                    : late ? ['overdue', 'Overdue']
                    : damaged ? ['damaged', `${damaged} damaged`]
                    : unsigned ? ['pending', 'Unsigned']
                    : null
                  const when = late ? `${late} ${late === 1 ? 'day' : 'days'} late`
                    : p.returnDate === today ? 'Today'
                    : p.returnDate ? new Date(p.returnDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'
                  return (
                    <li key={p.id}>
                      <Link to={`/admin/inventory?openProject=${p.id}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 min-h-[52px] py-2 hover:bg-white/5 rounded-lg px-2 -mx-2">
                        <span className={cn('text-xs font-bold tabular-nums', late ? 'text-[#ffb4ab]' : 'text-zinc-300')}>{when}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-zinc-100 truncate">{p.name}</span>
                          <span className="block text-xs text-zinc-400 truncate">{unitsSummary(items) || p.borrowers?.join(', ') || '—'}</span>
                        </span>
                        {flag
                          ? <span className="inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap" style={toneChip(flag[0])}>{flag[1]}</span>
                          : <span />}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
            {eq.out.length > 8 && <p className="text-[11px] text-zinc-500">+ {eq.out.length - 8} more</p>}
          </Panel>
        )}

        {/* ── Equipment requests ─────────────────────────────────────────── */}
        {canEquipment && (
          <Panel title="Equipment requests" icon={Package} to="/admin/equipment?tab=bookings" linkLabel="Bookings">
            {pending.length === 0 ? <Quiet>No requests waiting.</Quiet> : (
              <ul className="divide-y divide-white/5">
                {pending.slice(0, 6).map(b => (
                  <li key={b.id} className="py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{b.projectName || 'Booking'}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{b.isGuest ? b.guestName : b.studentName} · {b.items?.length ?? 0} {b.items?.length === 1 ? 'item' : 'items'}</p>
                    </div>
                    <span className="text-[11px] text-zinc-500 whitespace-nowrap">{b.checkoutDate} → {b.returnDate}</span>
                  </li>
                ))}
              </ul>
            )}
            {pickups.length > 0 && (
              <p className="text-xs text-zinc-400 border-t border-white/5 pt-2">
                <b className="text-zinc-200">{pickups.length}</b> confirmed {pickups.length === 1 ? 'booking is' : 'bookings are'} collected today: {pickups.map(b => b.projectName || b.studentName).join(', ')}
              </p>
            )}
          </Panel>
        )}

        {/* ── Bug reports (only when there are any; else the All clear line says so) ── */}
        {openBugs.length > 0 && (<Panel title="Open bug reports" icon={Bug} to="/admin/bug-reports">
          {openBugs.length === 0 ? <Quiet>No open bug reports.</Quiet> : (
            <ul className="divide-y divide-white/5">
              {openBugs.slice(0, 4).map(r => (
                <li key={r.id} className="py-2">
                  <p className="text-sm text-zinc-200 line-clamp-2">{r.description || '(no description)'}</p>
                  <p className="text-[11px] text-zinc-500 truncate">
                    {r.displayName} · {r.page}{r.createdAt && ` · ${r.createdAt.toDate().toLocaleDateString('sv-SE')}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>)}

        {/* ── Contact requests ───────────────────────────────────────────── */}
        {newContacts.length > 0 && (<Panel title="New contact requests" icon={Inbox} to="/admin/contact-requests">
          {newContacts.length === 0 ? <Quiet>No new contact requests.</Quiet> : (
            <ul className="divide-y divide-white/5">
              {newContacts.slice(0, 4).map(c => (
                <li key={c.id} className="py-2">
                  <p className="text-sm text-zinc-200 truncate">{c.name}{c.organisation && ` · ${c.organisation}`}</p>
                  <p className="text-[11px] text-zinc-500 line-clamp-1">{c.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>)}

        {/* ── Today and people ───────────────────────────────────────────── */}
        <Panel title="Today" icon={CalendarDays} to={academy ? '/admin/lessons' : undefined} linkLabel="Lessons">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {academy && <>
              <div><dt className="text-[11px] text-zinc-500">Lessons</dt><dd className="text-lg font-semibold text-zinc-100 tabular-nums">{lessons.length}</dd></div>
              <div><dt className="text-[11px] text-zinc-500 flex items-center gap-1"><UserX className="w-3 h-3" aria-hidden="true" /> Absence reports</dt><dd className="text-lg font-semibold text-zinc-100 tabular-nums">{absences.length}</dd></div>
            </>}
            {canEquipment && <div><dt className="text-[11px] text-zinc-500">Pickups</dt><dd className="text-lg font-semibold text-zinc-100 tabular-nums">{pickups.length}</dd></div>}
            {canInventory && <div><dt className="text-[11px] text-zinc-500">Returns due</dt><dd className="text-lg font-semibold text-zinc-100 tabular-nums">{eq.dueToday.length}</dd></div>}
          </dl>
        </Panel>

        <Panel title="People" icon={Users} to="/admin/users" linkLabel="Users">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-[11px] text-zinc-500">Students</dt><dd className="text-lg font-semibold text-zinc-100 tabular-nums">{people.students}</dd></div>
            <div><dt className="text-[11px] text-zinc-500">Teachers</dt><dd className="text-lg font-semibold text-zinc-100 tabular-nums">{people.teachers}</dd></div>
            <div><dt className="text-[11px] text-zinc-500">Admins</dt><dd className="text-lg font-semibold text-zinc-100 tabular-nums">{people.admins}</dd></div>
          </dl>
          {academy && (
            <Link to="/admin/cohorts" className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5" aria-hidden="true" /> {cohorts.length} {cohorts.length === 1 ? 'class' : 'classes'}
            </Link>
          )}
        </Panel>
      </div>
    </div>
  )
}
