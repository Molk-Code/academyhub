import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import {
  Package, ArchiveRestore, Bug, Inbox, RefreshCw, UtensilsCrossed, Car, CalendarDays, UserX,
  AlertTriangle, PenLine, ArrowRight, CheckCircle2, Users, GraduationCap,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import { useFeature } from '@/hooks/useFeature'
import { useModuleGate } from '@/hooks/useModules'
import { useAllUsers } from '@/hooks/useAllUsers'
import { useCalendarSyncAlert } from '@/hooks/useCalendarSyncAlert'
import { cn } from '@/lib/utils'
import { localDate, equipmentOut, pickupsToday, daysOverdue } from '@/lib/adminDashboard'
import type {
  EquipmentBookingDoc, InventoryProjectDoc, FoodBoxOrderDoc, MinivanBookingDoc, LessonDoc, AbsenceReportDoc, CohortDoc,
} from '@/types'

interface BugReport { id: string; status: string; description: string; displayName: string; page: string; createdAt?: Timestamp }
interface ContactRequest { id: string; status: string; name: string; organisation: string | null; message: string; createdAt?: Timestamp }

const newestFirst = <T extends { createdAt?: Timestamp }>(a: T, b: T) =>
  (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)

function greeting(h: number) {
  return h < 10 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// One count that needs the admin: highlighted when > 0, quiet when all clear
function ActionTile({ to, icon: Icon, label, count, detail }: {
  to: string; icon: React.ComponentType<{ className?: string }>; label: string; count: number; detail?: string
}) {
  const active = count > 0
  return (
    <Link
      to={to}
      className={cn(
        'rounded-2xl border p-4 flex flex-col gap-2 transition-colors',
        active ? 'border-brand-500/40 bg-brand-500/10 hover:bg-brand-500/15' : 'border-white/10 bg-zinc-900 hover:bg-white/5',
      )}
    >
      <div className="flex items-center justify-between">
        <Icon className={cn('w-4 h-4', active ? 'text-brand-400' : 'text-zinc-500')} />
        <ArrowRight className="w-3.5 h-3.5 text-zinc-600" aria-hidden="true" />
      </div>
      <p className={cn('text-2xl font-bold tabular-nums', active ? 'text-zinc-50' : 'text-zinc-500')}>{count}</p>
      <p className="text-xs font-medium text-zinc-300">{label}</p>
      <p className="text-[11px] text-zinc-500 -mt-1">{active ? detail : 'All clear'}</p>
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
  const { data: food } = useCollection<FoodBoxOrderDoc>('food_box_orders', [where('status', '==', 'pending')], canFoodBox)
  const { data: vans } = useCollection<MinivanBookingDoc>('minivan_bookings', [where('status', '==', 'pending')], canVehicles)
  const { data: lessons } = useCollection<LessonDoc>('lessons', [
    where('startTime', '>=', Timestamp.fromDate(dayStart)),
    where('startTime', '<', Timestamp.fromDate(dayEnd)),
  ], academy, today)
  const { data: absences } = useCollection<AbsenceReportDoc>('absence_reports', [where('date', '==', today)], academy, today)
  const { data: cohorts } = useCollection<CohortDoc>('cohorts', [], academy)
  const { data: users } = useAllUsers()
  const silentSyncs = useCalendarSyncAlert(academy)

  const pending = bookings.filter(b => b.status === 'pending').sort((a, b) => a.checkoutDate.localeCompare(b.checkoutDate))
  const pickups = pickupsToday(bookings, today)
  const eq = useMemo(() => equipmentOut(projects, today), [projects, today])
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

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title">{greeting(now.getHours())}{firstName && `, ${firstName}`}</h1>
        <p className="text-zinc-500 text-sm mt-1 capitalize">
          {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* ── Needs attention ─────────────────────────────────────────────── */}
      <section aria-labelledby="attention-title" className="space-y-3">
        <h2 id="attention-title" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Needs your attention</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {canEquipment && <ActionTile to="/admin/equipment?tab=bookings" icon={Package} label="Equipment requests" count={pending.length} detail="Waiting for a decision" />}
          {canInventory && <ActionTile to="/admin/inventory" icon={AlertTriangle} label="Overdue returns" count={eq.overdue.length} detail="Past their return date" />}
          {canInventory && <ActionTile to="/admin/inventory" icon={PenLine} label="Awaiting signatures" count={eq.awaitingSignatures.length} detail="Contracts not signed yet" />}
          <ActionTile to="/admin/bug-reports" icon={Bug} label="Open bug reports" count={openBugs.length} detail="Reported by users" />
          <ActionTile to="/admin/contact-requests" icon={Inbox} label="Contact requests" count={newContacts.length} detail="New, not handled" />
          {canFoodBox && <ActionTile to="/admin/food-box-orders" icon={UtensilsCrossed} label="Food box orders" count={food.length} detail="Waiting for approval" />}
          {canVehicles && <ActionTile to="/admin/minivan" icon={Car} label="Vehicle bookings" count={vans.length} detail="Waiting for approval" />}
          {academy && <ActionTile to="/admin/calendar-sync" icon={RefreshCw} label="Calendar sync" count={silentSyncs} detail="Outlook sync gone quiet" />}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Equipment out ──────────────────────────────────────────────── */}
        {canInventory && (
          <Panel title={`Equipment out (${eq.out.length})`} icon={ArchiveRestore} to="/admin/inventory" linkLabel="Inventory">
            {eq.out.length === 0 ? <Quiet>Nothing is checked out.</Quiet> : (
              <ul className="divide-y divide-white/5">
                {eq.out.slice(0, 8).map(p => {
                  const late = daysOverdue(p.returnDate, today)
                  return (
                    <li key={p.id}>
                      <Link to={`/admin/inventory?openProject=${p.id}`} className="flex items-center gap-3 py-2 hover:bg-white/5 rounded-lg px-2 -mx-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-200 truncate">{p.name}</p>
                          <p className="text-[11px] text-zinc-500 truncate">{p.borrowers?.join(', ') || '—'}</p>
                        </div>
                        {(p.pendingSignatureUids?.length ?? 0) > 0 && (
                          <span className="text-[10px] font-semibold text-amber-300 bg-amber-500/10 rounded-full px-2 py-0.5">Unsigned</span>
                        )}
                        <span className={cn('text-[11px] font-semibold whitespace-nowrap',
                          late ? 'text-rose-400' : p.returnDate === today ? 'text-amber-300' : 'text-zinc-500')}>
                          {late ? `${late} ${late === 1 ? 'day' : 'days'} late` : p.returnDate === today ? 'Due today' : `Due ${p.returnDate}`}
                        </span>
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

        {/* ── Bug reports ────────────────────────────────────────────────── */}
        <Panel title="Open bug reports" icon={Bug} to="/admin/bug-reports">
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
        </Panel>

        {/* ── Contact requests ───────────────────────────────────────────── */}
        <Panel title="New contact requests" icon={Inbox} to="/admin/contact-requests">
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
        </Panel>

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
