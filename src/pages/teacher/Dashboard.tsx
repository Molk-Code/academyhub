import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronRight, Plus, Clock, AlertTriangle, ClipboardList, Package } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { toDate, shortDate, timeStr } from '@/lib/utils'
import { format, isToday, formatDistanceToNow, startOfDay, differenceInDays } from 'date-fns'
import type { UserDoc, SubmissionDoc, LessonDoc, CohortDoc, AssignmentDoc, SubjectDoc, AbsenceReportDoc, DevelopmentPlan, SemesterEventDoc, SemesterCategoryDoc, EquipmentBookingDoc, InventoryProjectDoc } from '@/types'
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

function StatCard({ label, value, icon, color, to, alert }: {
  label: string; value: number; icon: string; color: 'blue' | 'orange' | 'purple' | 'red'; to: string; alert?: boolean
}) {
  const colors = {
    blue:   'bg-blue-500/10 border-blue-500/20 text-blue-400',
    orange: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    red:    'bg-red-500/10 border-red-500/20 text-red-400',
  }
  return (
    <Link to={to} className={`rounded-2xl border p-4 flex flex-col gap-1 hover:opacity-80 transition-opacity ${colors[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {alert && value > 0 && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      <p className="text-xs">{label}</p>
    </Link>
  )
}

function AttendanceCount({ lessonId }: { lessonId: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'lessons', lessonId, 'attendance'),
      snap => setCount(snap.size),
    )
    return unsub
  }, [lessonId])
  return <span className="text-sm font-bold text-emerald-600">{count} checked in</span>
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
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-400" /> Equipment
        </h2>
      </div>
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
  const { profile } = useAuth()
  const now = new Date()

  // Load cohorts this teacher manages
  const { data: cohorts, loading: cohortsLoading } = useCollection<CohortDoc>(
    'cohorts',
    profile ? [where('teacherIds', 'array-contains', profile.uid)] : [],
    !!profile,
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Good {timeOfDay} 👋</h1>
          <p className="text-zinc-500 mt-1 text-sm">{format(now, 'EEEE d MMMM yyyy')}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/teacher/lessons/new" className="btn-primary py-2.5">
            <Plus className="w-4 h-4" /> New Lesson
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Today's lessons"      value={todayLessons.length}        icon="📚" color="blue"   to="/teacher/lessons" />
        <StatCard label="Pending submissions"  value={pendingSubmissions.length}  icon="📝" color="orange" to="/teacher/assignments"       alert={pendingSubmissions.length > 0} />
        <StatCard label="Equipment requests"   value={pendingEquipment.length}    icon="📦" color="purple" to="/teacher/equipment-requests" alert={pendingEquipment.length > 0} />
        <StatCard label="Absence reports"      value={pendingAbsence.length}      icon="⚠️" color="red"    to="/teacher/students"          alert={pendingAbsence.length > 0} />
      </div>

      {/* ── Today's lessons ────────────────────────────────────────────── */}
      {todayLessons.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 mb-3 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-brand-500" /> Today's Lessons
          </h2>
          <div className="space-y-2">
            {todayLessons.map(lesson => (
              <div key={lesson.id} className="flex items-center gap-4 p-4 bg-zinc-900 border border-white/10 rounded-xl">
                <div className="text-center min-w-[52px]">
                  <p className="text-xs text-zinc-400">{timeStr(lesson.startTime)}</p>
                  <p className="text-xs text-zinc-400">{timeStr(lesson.endTime)}</p>
                </div>
                <div className="w-px h-8 bg-zinc-700 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{lesson.title}</p>
                  {lesson.classroom && (
                    <p className="text-xs text-zinc-500">{lesson.isOnline ? '🌐' : '📍'} {lesson.classroom}</p>
                  )}
                </div>
                <AttendanceCount lessonId={lesson.id} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Reminders */}
      {upcomingReminders.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <Clock className="w-5 h-5 text-brand-500" /> Upcoming Reminders
            </h2>
            <Link to="/teacher/semester-wheel" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {upcomingReminders.map(({ ev, active, days }) => (
              <Link
                key={ev.id}
                to="/teacher/semester-wheel"
                className="flex items-start gap-3 p-3.5 bg-zinc-900 border border-white/10 rounded-xl hover:border-brand-300 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: semesterCategories.find(c => c.name === ev.category)?.color ?? ev.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{ev.title}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {ev.startDate.replace(/^(\d{2})-(\d{2})$/, (_, m, d) => {
                      const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                      return `${mn[parseInt(m)-1]} ${parseInt(d)}`
                    })} – {ev.endDate.replace(/^(\d{2})-(\d{2})$/, (_, m, d) => {
                      const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                      return `${mn[parseInt(m)-1]} ${parseInt(d)}`
                    })}
                  </p>
                  <div className="mt-1.5">
                    {active
                      ? <span className="animate-pulse text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active now</span>
                      : <span className="text-[10px] text-zinc-500">
                          {days === 0 ? 'Starts today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
                        </span>
                    }
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Today's absences */}
      {todayAbsences.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Absent Today
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {todayAbsences.length}
              </span>
            </h2>
            <Link to="/teacher/students" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
              All reports <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-zinc-100">Submissions to Grade</h2>
            <Link to="/teacher/gradebook" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-2">
            {pendingSubmissions.slice(0, 5).map(sub => {
              const student = cohortStudents.find(s => s.uid === sub.studentId)
              return (
                <Link
                  key={sub.id}
                  to={`/teacher/gradebook?submission=${sub.id}`}
                  className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-xl hover:bg-white/5 transition-colors"
                >
                  {student && <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" enlargeable />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">
                      {student?.displayName ?? 'Student'}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">Assignment submission</p>
                  </div>
                  <span className="badge badge-amber flex-shrink-0">Needs grading</span>
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-zinc-100">Your Upcoming Lessons</h2>
            <Link to="/teacher/lessons" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
              All lessons <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingLessons.map(lesson => (
              <Link key={lesson.id} to="/teacher/lessons" className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-xl hover:bg-white/5 transition-colors">
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-zinc-100">Upcoming Assignments</h2>
          <Link to="/teacher/assignments" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
            All assignments <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="space-y-2">
          {upcomingAssignments.map(a => {
            const subject = subjectMap[a.subjectId]
            return (
              <div key={a.id} className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-xl">
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-brand-500" /> Plan Activity
            </h2>
            <span className="text-xs text-zinc-400">Last 7 days</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentPlanActivity.map(({ plan, student }) => student && (
              <Link
                key={plan.id}
                to={`/teacher/students/${student.uid}/plan`}
                className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-xl hover:border-brand-300 transition-colors"
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-zinc-100">Your Students</h2>
          <Link to="/teacher/students" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-0.5">
            View all <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cohortStudents.slice(0, 6).map(student => (
            <Link
              key={student.uid}
              to={`/teacher/students/${student.uid}`}
              className="flex items-center gap-3 p-3 bg-zinc-900 border border-white/10 rounded-xl hover:bg-white/5 transition-colors"
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
