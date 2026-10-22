import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, ChevronRight, Plus, AlertTriangle, ClipboardList, Package, BookOpen, FilePen, UserX,
  Clapperboard, BellRing, CalendarRange, DoorOpen, Users, Boxes, GraduationCap, FileText, ArrowRight,
} from 'lucide-react'
import { SectionHeader, SectionLink, KpiCard, ShortcutPill, LessonSlateCard } from '@/components/dashboard/Ember'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { toDate, shortDate, timeStr } from '@/lib/utils'
import { format, isToday, formatDistanceToNow, startOfDay, differenceInDays } from 'date-fns'
import type { UserDoc, SubmissionDoc, LessonDoc, CohortDoc, AssignmentDoc, SubjectDoc, AbsenceReportDoc, DevelopmentPlan, SemesterEventDoc, SemesterCategoryDoc, EquipmentBookingDoc, InventoryProjectDoc } from '@/types'
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

function AttendanceCount({ lessonId }: { lessonId: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'lessons', lessonId, 'attendance'),
      snap => setCount(snap.size),
    )
    return unsub
  }, [lessonId])
  return <span className="text-xs font-semibold text-ember-tertiary">{count} checked in</span>
}

function EquipmentWidget() {
  const today = new Date().toISOString().slice(0, 10)
  const { data: pendingBookings } = useCollection<EquipmentBookingDoc>(
    'equipment_bookings',
    [where('status', '==', 'pending')],
  )
  const { data: activeProjects } = useCollection<InventoryProjectDoc>(
    'inventory_projects',
    [where('status', 'in', ['active', 'checked-out'])],
  )
  const overdueProjects = activeProjects.filter(p => p.returnDate < today)

  if (pendingBookings.length === 0 && overdueProjects.length === 0) return null

  return (
    <div>
      <SectionHeader icon={Package} title="Equipment" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {pendingBookings.length > 0 && (
          <Link
            to="/teacher/equipment-requests"
            className="flex items-center gap-3 p-4 bg-amber-900/20 border border-amber-700/40 rounded-2xl hover:bg-amber-900/30 transition-colors"
          >
            <Package className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-200">{pendingBookings.length} pending request{pendingBookings.length !== 1 ? 's' : ''}</p>
              <p className="text-xs text-amber-400/70">Tap to review</p>
            </div>
            <ChevronRight className="w-4 h-4 text-amber-400 flex-shrink-0" />
          </Link>
        )}
        {overdueProjects.length > 0 && (
          <Link
            to="/teacher/inventory"
            className="flex items-center gap-3 p-4 bg-rose-900/20 border border-rose-700/40 rounded-2xl hover:bg-rose-900/30 transition-colors"
          >
            <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-rose-200">{overdueProjects.length} overdue project{overdueProjects.length !== 1 ? 's' : ''}</p>
              <p className="text-xs text-rose-400/70">Past return date</p>
            </div>
            <ChevronRight className="w-4 h-4 text-rose-400 flex-shrink-0" />
          </Link>
        )}
      </div>
    </div>
  )
}

export default function TeacherDashboard() {
  const { profile, role, roles } = useAuth()
  const isAdmin = roles.includes('admin') || role === 'admin'
  const now = new Date()

  // Admins see all cohorts; teachers only see their own
  const { data: cohorts, loading: cohortsLoading } = useCollection<CohortDoc>(
    'cohorts',
    isAdmin || !profile ? [] : [where('teacherIds', 'array-contains', profile.uid)],
    !!profile,
    isAdmin ? 'all' : (profile?.uid ?? ''),
  )

  // Students in those cohorts
  const { data: students } = useCollection<UserDoc>(
    'users',
    [where('role', '==', 'student')],
  )

  // Submissions pending grading — filtered to teacher's students after load
  const { data: allPendingSubmissions } = useCollection<SubmissionDoc>(
    'submissions',
    [where('status', '==', 'submitted'), orderBy('submittedAt', 'asc')],
  )

  // Subjects for lookup
  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const subjectMap = useMemo(() => Object.fromEntries(subjects.map(s => [s.id, s])), [subjects])

  // Upcoming assignments for teacher's cohorts
  const { data: rawAssignments } = useCollection<AssignmentDoc>('assignments')
  const upcomingAssignments = useMemo(() => {
    const nowMs = now.getTime()
    return [...rawAssignments]
      .filter(a => (a.dueDate?.toMillis?.() ?? 0) >= nowMs)
      .sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0))
      .slice(0, 5)
  }, [rawAssignments, now])

  // Upcoming lessons — use array-contains so multi-teacher assignments work
  const { data: rawLessons } = useCollection<LessonDoc>(
    'lessons',
    profile ? [where('teacherIds', 'array-contains', profile.uid)] : [],
    !!profile,
  )

  const lessons = rawLessons

  // Include cohorts from both cohort.teacherIds and lesson.cohortId to cover all associations
  const cohortIds = useMemo(() => {
    const fromCohorts = cohorts.map(c => c.id)
    const fromLessons = lessons.map(l => l.cohortId).filter(Boolean) as string[]
    return [...new Set([...fromCohorts, ...fromLessons])]
  }, [cohorts, lessons])

  const upcomingLessons = useMemo(() => {
    const sorted = [...lessons].sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0))
    return sorted.filter(l => (toDate(l.startTime) ?? now) >= now).slice(0, 4)
  }, [lessons, now])

  const cohortStudents = useMemo(
    () => students.filter(s => s.cohortId && cohortIds.includes(s.cohortId)),
    [students, cohortIds],
  )

  const cohortStudentUids = useMemo(() => new Set(cohortStudents.map(s => s.uid)), [cohortStudents])

  const pendingSubmissions = useMemo(
    () => allPendingSubmissions.filter(s => cohortStudentUids.has(s.studentId)),
    [allPendingSubmissions, cohortStudentUids],
  )

  const { data: allAbsences } = useCollection<AbsenceReportDoc>(
    'absence_reports',
    [orderBy('reportedAt', 'desc')],
  )

  const { data: pendingEquipment } = useCollection<EquipmentBookingDoc>(
    'equipment_bookings',
    [where('status', '==', 'pending')],
  )

  const { data: allPlans } = useCollection<DevelopmentPlan>('development_plans')
  const { data: semesterEvents }  = useCollection<SemesterEventDoc>('semester_events')
  const { data: semesterCategories } = useCollection<SemesterCategoryDoc>('semester_categories')
  const todayMmDd = format(now, 'MM-dd')

  const upcomingReminders = useMemo(() => {
    function isActive(ev: SemesterEventDoc) {
      const { startDate: s, endDate: e } = ev
      return s <= e
        ? todayMmDd >= s && todayMmDd <= e
        : todayMmDd >= s || todayMmDd <= e
    }
    function daysUntil(startDate: string): number {
      const [m, d] = startDate.split('-').map(Number)
      const target = startOfDay(new Date(now.getFullYear(), m - 1, d))
      const todayStart = startOfDay(now)
      if (target < todayStart) target.setFullYear(now.getFullYear() + 1)
      return differenceInDays(target, todayStart)
    }
    return [...semesterEvents]
      .filter(e => e.isActive)
      .sort((a, b) => {
        const aA = isActive(a), bA = isActive(b)
        if (aA !== bA) return aA ? -1 : 1
        return daysUntil(a.startDate) - daysUntil(b.startDate)
      })
      .slice(0, 3)
      .map(ev => ({ ev, active: isActive(ev), days: daysUntil(ev.startDate) }))
  }, [semesterEvents, todayMmDd])

  const recentPlanActivity = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    return allPlans
      .filter(p => (p.updatedAt?.toMillis?.() ?? 0) > cutoff)
      .map(p => ({ plan: p, student: cohortStudents.find(s => s.uid === p.studentId) }))
      .filter(x => x.student)
      .sort((a, b) => (b.plan.updatedAt?.toMillis?.() ?? 0) - (a.plan.updatedAt?.toMillis?.() ?? 0))
      .slice(0, 6)
  }, [allPlans, cohortStudents])

  const todayStr = format(now, 'yyyy-MM-dd')
  const todayAbsences = useMemo(
    () => allAbsences.filter(r => r.date === todayStr),
    [allAbsences, todayStr],
  )

  const todayLessons = useMemo(
    () => [...lessons]
      .filter(l => toDate(l.startTime)?.toISOString().slice(0, 10) === todayStr)
      .sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0)),
    [lessons, todayStr],
  )

  const pendingAbsence = useMemo(
    () => allAbsences.filter(r => r.status === 'pending'),
    [allAbsences],
  )

  const h = now.getHours()
  const timeOfDay = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'

  if (cohortsLoading) return <LoadingSpinner />

  return (
    <div className="space-y-7">
      {/* Header */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-zinc-100 tracking-tight truncate">Good {timeOfDay} 👋</h1>
            <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1 truncate">
              <CalendarDays className="w-3.5 h-3.5 text-brand-300 flex-shrink-0" />
              {format(now, 'EEEE d MMMM yyyy')}
            </p>
          </div>
          <Link to="/teacher/lessons/new" className="btn-primary py-2 px-3.5 flex-shrink-0 bg-gradient-to-r from-brand-500 to-brand-600">
            <Plus className="w-4 h-4" /> Lesson
          </Link>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ShortcutPill to="/teacher/lessons"       icon={CalendarDays}  label="Lessons" />
          <ShortcutPill to="/teacher/assignments"   icon={FileText}      iconClass="text-ember-secondary" label="Assignments" />
          <ShortcutPill to="/teacher/inventory"     icon={Boxes}         iconClass="text-ember-tertiary"  label="Inventory" />
          <ShortcutPill to="/teacher/room-bookings" icon={DoorOpen}      iconClass="text-ember-secondary" label="Rooms" />
          <ShortcutPill to="/teacher/students"      icon={GraduationCap} label="Students" />
        </div>
      </section>

      {/* Stat cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <KpiCard icon={BookOpen} value={todayLessons.length}       label="Today's lessons" to="/teacher/lessons" />
        <KpiCard icon={FilePen}  value={pendingSubmissions.length} label="Submissions"     to="/teacher/assignments"        iconClass="text-brand-300"        alert={pendingSubmissions.length > 0} highlight={pendingSubmissions.length > 0} />
        <KpiCard icon={Package}  value={pendingEquipment.length}   label="Gear requests"   to="/teacher/equipment-requests" iconClass="text-ember-secondary" alert={pendingEquipment.length > 0} />
        <KpiCard icon={UserX}    value={pendingAbsence.length}     label="Absence reports" to="/teacher/students"          alert={pendingAbsence.length > 0} highlight={pendingAbsence.length > 0} />
      </section>

      {/* ── Today's slate ───────────────────────────────────────────────── */}
      {todayLessons.length > 0 && (
        <section>
          <SectionHeader
            icon={Clapperboard}
            iconClass="text-ember-tertiary"
            title="Today's Slate"
            right={<span className="text-ember-tertiary">{todayLessons.length} lesson{todayLessons.length !== 1 ? 's' : ''}</span>}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {todayLessons.map(lesson => (
              <LessonSlateCard
                key={lesson.id}
                lesson={lesson}
                subject={subjectMap[lesson.subjectId]}
                footer={
                  <div className="flex items-center justify-between pt-1">
                    <AttendanceCount lessonId={lesson.id} />
                    <Link to="/teacher/lessons" className="flex items-center gap-1 px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium active:scale-95 transition-all">
                      Open <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Reminders — swipeable row */}
      {upcomingReminders.length > 0 && (
        <section>
          <SectionHeader
            icon={BellRing}
            iconClass="text-ember-secondary"
            title="Upcoming Reminders"
            right={<SectionLink to="/teacher/semester-wheel">View all</SectionLink>}
          />
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-3 sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {upcomingReminders.map(({ ev, active, days }) => {
              const dotColor = semesterCategories.find(c => c.name === ev.category)?.color ?? ev.color
              const fmt = (md: string) => md.replace(/^(\d{2})-(\d{2})$/, (_, m, d) => {
                const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                return `${mn[parseInt(m)-1]} ${parseInt(d)}`
              })
              return (
                <Link
                  key={ev.id}
                  to="/teacher/semester-wheel"
                  className="flex flex-col justify-between p-3.5 rounded-xl bg-zinc-900 min-w-[210px] max-w-[240px] sm:max-w-none flex-shrink-0 shadow-sm hover:bg-zinc-800 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    {active
                      ? <span className="px-2 py-0.5 rounded-full bg-ember-tertiary/15 text-ember-tertiary text-[10px] font-semibold animate-pulse">Active now</span>
                      : <span className="px-2 py-0.5 rounded-full bg-ember-secondary/15 text-ember-secondary text-[10px] font-semibold">
                          {days === 0 ? 'Starts today' : days === 1 ? 'Tomorrow' : `in ${days} days`}
                        </span>}
                    <span className="w-2.5 h-2.5 rounded-full mt-1" style={{ backgroundColor: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
                  </div>
                  <p className="text-sm font-semibold text-zinc-100 truncate mb-3">{ev.title}</p>
                  <div className="flex items-center gap-1 text-zinc-400 text-[11px] bg-zinc-950/40 rounded px-2 py-1">
                    <CalendarRange className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{fmt(ev.startDate)} – {fmt(ev.endDate)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Today's absences */}
      {todayAbsences.length > 0 && (
        <div>
          <SectionHeader
            icon={AlertTriangle}
            iconClass="text-amber-400"
            title={`Absent Today · ${todayAbsences.length}`}
            right={<SectionLink to="/teacher/students">All reports</SectionLink>}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {todayAbsences.map(r => (
              <div key={r.id} className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-100 truncate">{r.studentName}</p>
                  <p className="text-xs text-amber-700">
                    {r.type === 'full_day' ? 'Full day' : `Lesson: ${r.lessonTitle ?? '—'}`}
                  </p>
                  {r.reason && <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{r.reason}</p>}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                  r.status === 'reviewed' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-amber-900/40 text-amber-400'
                }`}>
                  {r.status === 'reviewed' ? 'Reviewed' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending submissions */}
        <div>
          <SectionHeader
            icon={FilePen}
            title="Needs Attention"
            right={pendingSubmissions.length > 0
              ? <SectionLink to="/teacher/gradebook">{pendingSubmissions.length} pending</SectionLink>
              : <SectionLink to="/teacher/gradebook">Gradebook</SectionLink>}
          />
          <div className="space-y-2">
            {pendingSubmissions.slice(0, 5).map(sub => {
              const student = cohortStudents.find(s => s.uid === sub.studentId)
              return (
                <Link
                  key={sub.id}
                  to={`/teacher/gradebook?submission=${sub.id}`}
                  className="relative overflow-hidden flex items-center gap-3 p-3 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-colors shadow-md"
                >
                  <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-brand-500/10 blur-2xl pointer-events-none" />
                  {student && <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" enlargeable />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">
                      {student?.displayName ?? 'Student'}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">Assignment submission</p>
                  </div>
                  <span className="flex-shrink-0 px-2.5 py-1 rounded-full bg-brand-500/15 text-brand-300 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap">Needs grading</span>
                </Link>
              )
            })}
            {pendingSubmissions.length === 0 && (
              <p className="text-sm text-zinc-500 text-center py-8">All caught up! No submissions to grade.</p>
            )}
          </div>
        </div>

        {/* Upcoming lessons */}
        <div>
          <SectionHeader
            icon={CalendarDays}
            iconClass="text-ember-secondary"
            title="Your Upcoming Lessons"
            right={<SectionLink to="/teacher/lessons">All lessons</SectionLink>}
          />
          <div className="space-y-2">
            {upcomingLessons.map(lesson => (
              <Link key={lesson.id} to="/teacher/lessons" className="flex items-center gap-3 p-3 bg-zinc-900 rounded-xl hover:bg-zinc-800 transition-colors">
                <div className="text-center min-w-[48px]">
                  <p className="text-xs text-zinc-500">{shortDate(lesson.startTime).split(' ')[0]}</p>
                  <p className="text-lg font-bold text-zinc-100">{shortDate(lesson.startTime).split(' ')[1]}</p>
                </div>
                <div className="w-px h-8 bg-zinc-700" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-100 truncate">{lesson.title}</p>
                  <p className="text-xs text-zinc-500">
                    {timeStr(lesson.startTime)}–{timeStr(lesson.endTime)} · {lesson.isOnline ? 'Online' : lesson.classroom}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-300 flex-shrink-0" />
              </Link>
            ))}
            {upcomingLessons.length === 0 && (
              <p className="text-sm text-zinc-500 text-center py-8">No upcoming lessons scheduled.</p>
            )}
          </div>
        </div>
      </div>

      {/* Upcoming assignments */}
      <div>
        <SectionHeader
          icon={FileText}
          iconClass="text-ember-secondary"
          title="Upcoming Assignments"
          right={<SectionLink to="/teacher/assignments">All assignments</SectionLink>}
        />
        <div className="space-y-2">
          {upcomingAssignments.map(a => {
            const subject = subjectMap[a.subjectId]
            return (
              <div key={a.id} className="flex items-center gap-3 p-3 bg-zinc-900 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-100 truncate">{a.title}</p>
                  <p className="text-xs text-zinc-500">
                    {subject ? `${subject.iconEmoji} ${subject.title} · ` : ''}
                    Due {shortDate(a.dueDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!a.isPublished && (
                    <span className="badge bg-zinc-800 text-zinc-500">Draft</span>
                  )}
                  <span className="text-amber-600 text-sm font-medium">+{a.pointsValue} pts</span>
                </div>
              </div>
            )
          })}
          {upcomingAssignments.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-8">No upcoming assignments.</p>
          )}
        </div>
      </div>

      {/* Plan activity */}
      {recentPlanActivity.length > 0 && (
        <div>
          <SectionHeader
            icon={ClipboardList}
            title="Plan Activity"
            right={<span className="text-zinc-500 font-medium">Last 7 days</span>}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentPlanActivity.map(({ plan, student }) => student && (
              <Link
                key={plan.id}
                to={`/teacher/students/${student.uid}/plan`}
                className="flex items-center gap-3 p-3 bg-zinc-900 rounded-xl hover:bg-zinc-800 transition-colors"
              >
                <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" enlargeable />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-100 truncate">{student.displayName}</p>
                  <p className="text-xs text-zinc-400">
                    Updated {plan.updatedAt ? formatDistanceToNow(plan.updatedAt.toDate(), { addSuffix: true }) : ''}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-300 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Equipment widget */}
      <EquipmentWidget />

      {/* Student list preview */}
      <div>
        <SectionHeader
          icon={Users}
          iconClass="text-ember-secondary"
          title="Your Students"
          right={<SectionLink to="/teacher/students">View all</SectionLink>}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cohortStudents.slice(0, 6).map(student => (
            <Link
              key={student.uid}
              to={`/teacher/students/${student.uid}`}
              className="flex items-center gap-3 p-3 bg-zinc-900 rounded-xl hover:bg-zinc-800 transition-colors"
            >
              <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" enlargeable />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-100 truncate">{student.displayName}</p>
                <p className="text-xs text-zinc-500 tabular-nums">{student.totalPoints} pts</p>
              </div>
              {!student.isActive && <span className="badge badge-rose">Inactive</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
