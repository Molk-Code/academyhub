import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { isPast, differenceInDays, format } from 'date-fns'
import { BookOpen, ChevronRight, CalendarRange, Clapperboard, Clock, CheckCircle2, XCircle, UtensilsCrossed, Car, ListChecks, Square, Sparkles, ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyProgress } from '@/hooks/useProgress'
import { useCollection, useDocument, where, orderBy } from '@/hooks/useFirestore'
import { toDate, cn } from '@/lib/utils'
import { getDoc, doc as fsDoc, limit } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { LessonDoc, AssignmentDoc, SubjectDoc, SubmissionDoc, SemesterSettingsDoc, CohortDoc, ProductionTeamDoc, FoodBoxOrderDoc, MinivanBookingDoc, TodoDoc } from '@/types'
import ProgressRing     from '@/components/dashboard/ProgressRing'
import XPBar            from '@/components/dashboard/XPBar'
import PointsBadge      from '@/components/dashboard/PointsBadge'
import StreakBadge      from '@/components/dashboard/StreakBadge'
import { LessonCard, DeadlineCard } from '@/components/dashboard/UpcomingCard'
import LoadingSpinner   from '@/components/common/LoadingSpinner'
import EmptyState       from '@/components/common/EmptyState'

interface PointsLogEntry { id: string; studentId: string; points: number; reason: string; createdAt: any }

interface CheckInProps { lessons: LessonDoc[], uid: string }

function CheckInStatus({ lessons, uid }: CheckInProps) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayLessonIds = useMemo(
    () => lessons.filter(l => toDate(l.startTime)?.toISOString().slice(0, 10) === todayStr).map(l => l.id),
    [lessons, todayStr],
  )
  const [checkedIn, setCheckedIn] = useState<boolean | null>(null)
  const key = todayLessonIds.join(',')
  useEffect(() => {
    if (!todayLessonIds.length) { setCheckedIn(false); return }
    Promise.all(todayLessonIds.map(id => getDoc(fsDoc(db, 'lessons', id, 'attendance', uid))))
      .then(snaps => setCheckedIn(snaps.some(s => s.exists())))
  }, [key, uid])
  if (todayLessonIds.length === 0) return null
  if (checkedIn === null) return null
  if (checkedIn) {
    return (
      <div className="flex items-center gap-3 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl px-5 py-4">
        <span className="text-2xl">✅</span>
        <div>
          <p className="font-semibold text-emerald-300">Checked in today</p>
          <p className="text-xs text-emerald-500">Your attendance has been recorded.</p>
        </div>
      </div>
    )
  }
  return (
    <Link to="/checkin" className="flex items-center gap-3 bg-rose-950/40 border border-rose-800/50 rounded-2xl px-5 py-4 hover:bg-rose-950/60 transition-colors">
      <span className="text-2xl">📍</span>
      <div className="flex-1">
        <p className="font-semibold text-rose-300">Check in now</p>
        <p className="text-xs text-rose-500">You have a lesson today — tap to check in.</p>
      </div>
      <ArrowRight className="w-4 h-4 text-rose-400" />
    </Link>
  )
}

export default function StudentDashboard() {
  const { profile, cohortId: ctxCohortId, previewCohortId } = useAuth()
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? null
  const { data: progress, loading: progressLoading } = useMyProgress()

  const now = new Date()

  // Upcoming lessons — no compound orderBy to avoid composite index requirement
  const { data: rawLessons } = useCollection<LessonDoc>(
    'lessons',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )
  const lessons = useMemo(
    () => [...rawLessons].sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0)),
    [rawLessons],
  )

  // Assignments — no compound orderBy
  const { data: rawAssignments } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )
  const assignments = useMemo(
    () => [...rawAssignments].sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0)),
    [rawAssignments],
  )

  // Student's own submissions
  const { data: submissions } = useCollection<SubmissionDoc>(
    'submissions',
    profile
      ? [where('studentId', '==', profile.uid)]
      : [],
    !!profile,
  )

  // Production team
  const { data: allTeams } = useCollection<ProductionTeamDoc>(
    'production_teams',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )
  const myTeam = useMemo(
    () => allTeams.find(t => profile && t.memberIds.includes(profile.uid)) ?? null,
    [allTeams, profile],
  )
  const dailyCommandment = useMemo(() => {
    if (!myTeam || myTeam.commandments.length === 0) return null
    const sorted = [...myTeam.commandments].sort((a, b) => a.order - b.order)
    return sorted[Math.floor(Date.now() / 86400000) % sorted.length]
  }, [myTeam])

  // Subjects for colour lookup
  const { data: subjects } = useCollection<SubjectDoc>('subjects')

  // Active bookings for dashboard widget
  const { data: foodOrders } = useCollection<FoodBoxOrderDoc>(
    'food_box_orders',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
  )
  const { data: minivanBookings } = useCollection<MinivanBookingDoc>(
    'minivan_bookings',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
  )
  // Personal todos for dashboard widget
  const { data: myTodos } = useCollection<TodoDoc>(
    'todos',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
  )
  const widgetTodos = useMemo(
    () => myTodos
      .filter(t => !t.isCompleted)
      .sort((a, b) => {
        if (a.category === 'urgent' && b.category !== 'urgent') return -1
        if (a.category !== 'urgent' && b.category === 'urgent') return 1
        return a.order - b.order
      })
      .slice(0, 4),
    [myTodos],
  )

  const activeBookings = useMemo(() => {
    const food = foodOrders
      .filter(o => o.status === 'pending' || o.status === 'confirmed')
      .slice(0, 3)
      .map(o => {
        const time = o.adminPickupTime ?? o.pickupTime
        return {
          id: o.id, type: 'food' as const,
          label: `Food box – ${o.date}${time ? ` · ${time}` : ''}`,
          status: o.status,
          timeModified: !!o.pickupTimeModified,
        }
      })
    const van = minivanBookings
      .filter(b => b.status === 'pending' || b.status === 'approved')
      .slice(0, 3)
      .map(b => ({
        id: b.id, type: 'van' as const,
        label: `Minivan – ${b.destination} · ${b.adminDateFrom ?? b.dateFrom} ${b.adminTimeFrom ?? b.timeFrom}`,
        status: b.status,
        timeModified: !!b.scheduleModified,
      }))
    return [...food, ...van].slice(0, 5)
  }, [foodOrders, minivanBookings])

  const { data: recentLog } = useCollection<PointsLogEntry>(
    'points_log',
    profile ? [where('studentId', '==', profile.uid), orderBy('createdAt', 'desc'), limit(3)] : [],
    !!profile,
  )

  // Semester dates — cohort-level overrides global setting
  const { data: semesterDoc } = useDocument<SemesterSettingsDoc>('settings', 'semester')
  const { data: cohortDoc }   = useDocument<CohortDoc>('cohorts', cohortId ?? undefined)
  const activeSemester = useMemo(() => {
    const todayStr = now.toISOString().slice(0, 10)
    const sem2Start = cohortDoc?.semesterSem2StartDate ?? semesterDoc?.sem2Start
    const sem2End   = cohortDoc?.semesterSem2EndDate   ?? semesterDoc?.sem2End
    // If today is on or after sem2 start, show sem2
    if (sem2Start && todayStr >= sem2Start) {
      return { startDate: sem2Start, endDate: sem2End ?? sem2Start }
    }
    const sem1Start = cohortDoc?.semesterStartDate ?? semesterDoc?.startDate
    const sem1End   = cohortDoc?.semesterEndDate   ?? semesterDoc?.endDate
    if (sem1Start && sem1End) return { startDate: sem1Start, endDate: sem1End }
    return null
  }, [cohortDoc, semesterDoc, now])

  const subjectMap = useMemo(
    () => Object.fromEntries(subjects.map(s => [s.id, s])),
    [subjects],
  )

  const submittedIds = useMemo(
    () => new Set(submissions.filter(s => s.status !== 'draft').map(s => s.assignmentId)),
    [submissions],
  )

  const upcomingLessons = useMemo(
    () => lessons.filter(l => (toDate(l.startTime) ?? now) >= now).slice(0, 4),
    [lessons, now],
  )

  const pendingAssignments = useMemo(
    () => assignments
      .filter(a => a.isPublished && !submittedIds.has(a.id))
      .slice(0, 5),
    [assignments, submittedIds],
  )

  if (progressLoading) return <LoadingSpinner />

  const greeting = () => {
    const h = now.getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-100">
            {greeting()}, {profile?.displayName?.split(' ')[0]} 👋
          </h1>
          <p className="text-zinc-500 mt-1">Keep up the great work on your filmmaking journey.</p>
        </div>
        <div className="flex items-center gap-3">
          <StreakBadge days={progress?.streakDays ?? 0} />
          <PointsBadge totalPoints={profile?.totalPoints ?? 0} pointsRedeemed={profile?.pointsRedeemed ?? 0} />
        </div>
      </div>

      {/* ── Semester banner ────────────────────────────────────────────────── */}
      {activeSemester && (() => {
        const start   = new Date(`${activeSemester.startDate}T00:00:00`)
        const end     = new Date(`${activeSemester.endDate}T00:00:00`)
        const total   = differenceInDays(end, start)
        const elapsed = Math.min(Math.max(differenceInDays(now, start), 0), total)
        const pct     = total > 0 ? Math.round((elapsed / total) * 100) : 0
        const daysLeft = Math.max(differenceInDays(end, now), 0)
        const isOver   = now > end
        return (
          <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5">
            <div className="flex items-center justify-between mb-3 gap-4">
              <div className="flex items-center gap-2">
                <CalendarRange className="w-4 h-4 text-brand-500 flex-shrink-0" />
                <p className="text-sm font-semibold text-zinc-200">Semester Progress</p>
              </div>
              <div className="text-right flex-shrink-0">
                {isOver ? (
                  <span className="text-xs font-medium text-zinc-400">Semester ended</span>
                ) : (
                  <span className="text-xs font-medium text-brand-600">{daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</span>
                )}
              </div>
            </div>
            <div className="relative h-2.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-brand-500 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-zinc-400">{format(start, 'd MMM yyyy')}</span>
              <span className="text-xs font-medium text-zinc-500">{pct}% complete</span>
              <span className="text-xs text-zinc-400">{format(end, 'd MMM yyyy')}</span>
            </div>
          </div>
        )
      })()}

      {/* ── Daily commandment ──────────────────────────────────────────────── */}
      {dailyCommandment && myTeam && (
        <Link to="/production">
          <div
            className="rounded-2xl p-5 text-white shadow-lg hover:opacity-95 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${myTeam.color}cc, ${myTeam.color})` }}
          >
            <div className="flex items-center gap-2 mb-2 opacity-75">
              <Clapperboard className="w-4 h-4" />
              <p className="text-xs font-bold uppercase tracking-widest">
                {myTeam.emoji} {myTeam.name} — Today's Commandment
              </p>
            </div>
            <p className="text-lg font-bold leading-snug">{dailyCommandment.text}</p>
          </div>
        </Link>
      )}

      {/* ── Upcoming lessons + pending assignments ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming lessons */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Upcoming Lessons</h2>
            <Link to="/calendar" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
              Calendar <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {upcomingLessons.length === 0
            ? <EmptyState icon={BookOpen} title="No upcoming lessons" description="Check back later." />
            : upcomingLessons.map(lesson => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  subjectColor={subjectMap[lesson.subjectId]?.color}
                  subjectTitle={subjectMap[lesson.subjectId]?.title}
                />
              ))
          }
        </div>

        {/* Pending assignments */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Pending Assignments</h2>
            <Link to="/subjects" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
              All subjects <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {pendingAssignments.length === 0
            ? <EmptyState icon={BookOpen} title="All caught up!" description="No pending assignments." />
            : pendingAssignments.map(a => (
                <DeadlineCard
                  key={a.id}
                  assignment={a}
                  subjectColor={subjectMap[a.subjectId]?.color}
                  subjectTitle={subjectMap[a.subjectId]?.title}
                  isOverdue={isPast(toDate(a.dueDate) ?? new Date())}
                />
              ))
          }
        </div>
      </div>

      {/* ── Check-in status ─────────────────────────────────────────────── */}
      {profile && <CheckInStatus lessons={lessons} uid={profile.uid} />}

      {/* ── My Points ────────────────────────────────────────────────────── */}
      {profile && (() => {
        const total = profile.totalPoints ?? 0
        const redeemed = profile.pointsRedeemed ?? 0
        const available = total - redeemed
        const milestone = Math.ceil((total + 1) / 100) * 100
        const progress = total % 100
        const reasonLabel = (r: string) => {
          if (r === 'test_pass') return 'Test passed'
          if (r === 'assignment_graded') return 'Assignment graded'
          if (r === 'attendance') return 'Attendance check-in'
          if (r === 'redemption') return 'Prize redeemed'
          if (r === 'redemption_refund') return 'Prize refund'
          if (r === 'bonus') return 'Bonus'
          return r
        }
        return (
          <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" /> My Points
              </h2>
              <Link to="/prizes" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
                Prizes <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="flex items-end gap-6">
              <div>
                <p className="text-3xl font-bold text-amber-600 tabular-nums">{available}</p>
                <p className="text-xs text-zinc-400">available</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-zinc-500 tabular-nums">{total}</p>
                <p className="text-xs text-zinc-400">earned total</p>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-zinc-400 mb-1">
                <span>{progress} pts</span>
                <span>Next milestone: {milestone} pts</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
            {recentLog.length > 0 && (
              <div className="space-y-1.5 border-t border-white/8 pt-3">
                {recentLog.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">{reasonLabel(entry.reason)}</span>
                    <div className="flex items-center gap-2">
                      <span className={cn('font-semibold tabular-nums', entry.points >= 0 ? 'text-emerald-600' : 'text-rose-500')}>
                        {entry.points >= 0 ? '+' : ''}{entry.points}
                      </span>
                      <span className="text-zinc-400 text-xs">
                        {entry.createdAt?.toDate ? format(entry.createdAt.toDate(), 'd MMM') : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Quick links ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="section-title mb-3">Quick Access</h2>
        <div className="grid grid-cols-3 gap-3">
          <Link to="/checkin" className="flex flex-col items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl p-4 transition-colors text-center">
            <span className="text-2xl">📷</span>
            <span className="text-sm font-semibold">Check In</span>
          </Link>
          <Link to="/booking" className="flex flex-col items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white rounded-2xl p-4 transition-colors text-center">
            <span className="text-2xl">🚪</span>
            <span className="text-sm font-semibold">Book Room</span>
          </Link>
          <Link to="/guide" className="flex flex-col items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl p-4 transition-colors text-center">
            <span className="text-2xl">📖</span>
            <span className="text-sm font-semibold">Guide</span>
          </Link>
        </div>
      </div>

      {/* ── Active bookings ────────────────────────────────────────────────── */}
      {activeBookings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Active Bookings</h2>
            <Link to="/booking" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
              All bookings <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeBookings.map(b => {
              const statusColor = b.status === 'pending'
                ? 'bg-amber-950/40 text-amber-300 border-amber-800/50'
                : 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
              const StatusIcon = b.status === 'pending' ? Clock : CheckCircle2
              return (
                <Link key={b.id} to="/booking" className="bg-zinc-900 rounded-xl border border-white/10 px-4 py-3 flex items-center gap-3 hover:border-brand-300 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                    {b.type === 'food'
                      ? <UtensilsCrossed className="w-4 h-4 text-zinc-500" />
                      : <Car className="w-4 h-4 text-zinc-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">{b.label}</p>
                    {b.timeModified && (
                      <p className="text-[10px] font-bold text-amber-600 mt-0.5">⏰ Time updated by admin</p>
                    )}
                  </div>
                  <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0', statusColor)}>
                    <StatusIcon className="w-3 h-3" />
                    {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── My Tasks widget ───────────────────────────────────────────────── */}
      {widgetTodos.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-zinc-400" /> My Tasks
            </h2>
            <Link to="/my-plan" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
              All tasks <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-2">
            {widgetTodos.map(t => (
              <div key={t.id} className="bg-zinc-900 rounded-xl border border-white/10 px-4 py-3 flex items-center gap-3">
                <Square className="w-4 h-4 text-zinc-300 flex-shrink-0" />
                <span className="flex-1 text-sm text-zinc-200">{t.title}</span>
                {t.category === 'urgent' && (
                  <span className="text-[10px] font-bold bg-rose-950/40 text-rose-300 px-1.5 py-0.5 rounded-full border border-rose-800/50">Urgent</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Progress row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Overall ring */}
        <div className="card flex flex-col items-center justify-center gap-4">
          <ProgressRing
            percentage={progress?.overallPercentage ?? 0}
            label="Complete"
            sublabel="Overall"
          />
          <div className="text-center">
            <p className="text-sm font-semibold text-zinc-300">Course Progress</p>
            <p className="text-xs text-zinc-400">
              {progress?.completedAssignments ?? 0} of {progress?.totalAssignments ?? 0} assignments done
            </p>
          </div>
        </div>

        {/* Subject bars */}
        <div className="card col-span-2 space-y-4">
          <h2 className="section-title">Progress by Subject</h2>
          {subjects.length === 0 ? (
            <p className="text-sm text-zinc-400">No subjects added yet.</p>
          ) : (
            subjects.map(subject => {
              const sp = progress?.subjectProgress?.[subject.id]
              return (
                <XPBar
                  key={subject.id}
                  label={`${subject.iconEmoji} ${subject.title}`}
                  current={sp?.completed ?? 0}
                  max={sp?.total ?? 1}
                  color={subject.color ?? 'bg-brand-500'}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
