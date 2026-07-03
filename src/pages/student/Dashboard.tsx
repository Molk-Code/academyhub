import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { isPast, differenceInDays, format, startOfDay } from 'date-fns'
import { BookOpen, ChevronRight, CalendarRange, Clapperboard, Clock, CheckCircle2, XCircle, UtensilsCrossed, Car, ListChecks, Plus, Sparkles, ArrowRight, Package } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyProgress } from '@/hooks/useProgress'
import { useCollection, useDocument, where, orderBy } from '@/hooks/useFirestore'
import { toDate, cn } from '@/lib/utils'
import { getDoc, doc, addDoc, updateDoc, serverTimestamp, limit, getDocs, collection, query, orderBy as fbOrderBy, where as fbWhere } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { LessonDoc, AssignmentDoc, SubjectDoc, SubmissionDoc, SemesterSettingsDoc, CohortDoc, ProductionTeamDoc, FoodBoxOrderDoc, MinivanBookingDoc, TodoDoc, TodoCategory, EquipmentBookingDoc, UserDoc } from '@/types'

import ProgressRing     from '@/components/dashboard/ProgressRing'
import XPBar            from '@/components/dashboard/XPBar'
import PointsBadge      from '@/components/dashboard/PointsBadge'
import StreakBadge      from '@/components/dashboard/StreakBadge'
import { LessonCard, DeadlineCard } from '@/components/dashboard/UpcomingCard'
import LoadingSpinner   from '@/components/common/LoadingSpinner'
import EmptyState       from '@/components/common/EmptyState'
import Avatar           from '@/components/common/Avatar'

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
    Promise.all(todayLessonIds.map(id => getDoc(doc(db, 'lessons', id, 'attendance', uid))))
      .then(snaps => setCheckedIn(snaps.some(s => s.exists())))
  }, [key, uid])
  if (todayLessonIds.length === 0) return null
  if (checkedIn === null) return null
  if (checkedIn) {
    return (
      <div className="flex items-center gap-3 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl px-5 py-4">
        <span className="text-2xl">✅</span>
        <div>
          <p className="font-semibold text-emerald-300">Checked in today — +5 pts earned!</p>
          <p className="text-xs text-emerald-600">Your attendance has been recorded.</p>
        </div>
      </div>
    )
  }
  return (
    <Link to="/checkin" className="flex items-center gap-3 bg-amber-950/40 border border-amber-800/50 rounded-2xl px-5 py-4 hover:bg-amber-950/60 transition-colors">
      <span className="text-2xl">📍</span>
      <div className="flex-1">
        <p className="font-semibold text-amber-300">Class today — don't forget to check in!</p>
        <p className="text-xs text-amber-600">Tap to open the QR scanner.</p>
      </div>
      <ArrowRight className="w-4 h-4 text-amber-400" />
    </Link>
  )
}

function StudentEquipmentWidget({ uid }: { uid: string }) {
  const today = new Date().toISOString().slice(0, 10)
  const { data: bookings } = useCollection<EquipmentBookingDoc>(
    'equipment_bookings',
    [where('studentId', '==', uid)],
    !!uid,
    uid,
  )
  const activeBookings = bookings.filter(b => b.status === 'confirmed' || b.status === 'checked-out')
  if (activeBookings.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-title flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-400" /> My Equipment
        </h2>
        <Link to="/booking/equipment" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
          View all <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="space-y-2">
        {activeBookings.map(b => {
          const overdue = b.status === 'checked-out' && b.returnDate < today
          return (
            <Link
              key={b.id}
              to="/booking/equipment"
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                overdue
                  ? 'bg-rose-900/20 border-rose-700/40 hover:bg-rose-900/30'
                  : 'bg-zinc-900 border-white/8 hover:bg-white/5',
              )}
            >
              <Package className={cn('w-4 h-4 flex-shrink-0', overdue ? 'text-rose-400' : 'text-brand-400')} />
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm font-medium', overdue ? 'text-rose-200' : 'text-zinc-100')}>{b.projectName}</p>
                <p className={cn('text-xs', overdue ? 'text-rose-400' : 'text-zinc-400')}>
                  {b.status === 'confirmed' ? `Ready for pickup · ${b.checkoutDate}` : overdue ? `Overdue — due ${b.returnDate}` : `Due back ${b.returnDate}`}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function WeekAtAGlance({ lessons, assignments }: { lessons: LessonDoc[], assignments: AssignmentDoc[] }) {
  const days = useMemo(() => {
    const today = startOfDay(new Date())
    const monday = new Date(today)
    monday.setDate(today.getDate() - today.getDay() + 1)
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const dateStr = format(d, 'yyyy-MM-dd')
      const dayLessons = lessons.filter(l => {
        const ld = l.startTime?.toDate?.()
        return ld && format(startOfDay(ld), 'yyyy-MM-dd') === dateStr
      })
      const dayDeadlines = assignments.filter(a => {
        const dd = a.dueDate?.toDate?.()
        return dd && format(startOfDay(dd), 'yyyy-MM-dd') === dateStr
      })
      return { date: d, dateStr, lessons: dayLessons, deadlines: dayDeadlines, isToday: startOfDay(d).getTime() === today.getTime() }
    })
  }, [lessons, assignments])

  return (
    <div className="mb-6">
      <h2 className="section-title mb-3">This week</h2>
      <div className="grid grid-cols-5 gap-2">
        {days.map((day) => (
          <div key={day.dateStr} className={`rounded-xl p-2 border text-center transition-colors ${
            day.isToday
              ? 'bg-brand-500/15 border-brand-500/40'
              : 'bg-white/5 border-white/8'
          }`}>
            <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${day.isToday ? 'text-brand-400' : 'text-zinc-500'}`}>
              {format(day.date, 'EEE')}
            </p>
            <p className={`text-sm font-bold ${day.isToday ? 'text-brand-300' : 'text-zinc-300'}`}>
              {format(day.date, 'd')}
            </p>
            <div className="mt-1.5 space-y-0.5 min-h-[20px]">
              {day.lessons.length > 0 && (
                <div className="w-full h-1.5 bg-blue-500/60 rounded-full" title={`${day.lessons.length} lesson${day.lessons.length > 1 ? 's' : ''}`} />
              )}
              {day.deadlines.length > 0 && (
                <div className="w-full h-1.5 bg-rose-500/60 rounded-full" title={`${day.deadlines.length} deadline${day.deadlines.length > 1 ? 's' : ''}`} />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-2">
        <span className="text-xs text-zinc-600 flex items-center gap-1.5"><span className="w-2 h-2 bg-blue-500/60 rounded-full inline-block" /> Lessons</span>
        <span className="text-xs text-zinc-600 flex items-center gap-1.5"><span className="w-2 h-2 bg-rose-500/60 rounded-full inline-block" /> Deadlines</span>
      </div>
    </div>
  )
}

function Leaderboard({ cohortId, currentUid }: { cohortId: string, currentUid: string }) {
  const [leaders, setLeaders] = useState<{ uid: string; displayName: string; totalPoints: number; avatarColor: string; avatarUrl?: string }[]>([])

  useEffect(() => {
    getDocs(
      query(
        collection(db, 'users'),
        fbWhere('cohortId', '==', cohortId),
        fbOrderBy('totalPoints', 'desc'),
        limit(5),
      )
    ).then(snap => {
      setLeaders(snap.docs.map(d => ({
        uid:          d.id,
        displayName:  d.data().displayName ?? 'Student',
        totalPoints:  d.data().totalPoints ?? 0,
        avatarColor:  d.data().avatarColor ?? '#f26419',
        avatarUrl:    d.data().avatarUrl,
      })))
    }).catch(() => {})
  }, [cohortId])

  if (!leaders.length) return null
  const maxPoints = leaders[0]?.totalPoints || 1
  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="mb-2">
      <h2 className="section-title mb-3 flex items-center gap-2">🏆 Class Leaderboard</h2>
      <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden">
        {leaders.map((user, i) => {
          const isMe = user.uid === currentUid
          return (
            <div key={user.uid} className={`flex items-center gap-3 px-4 py-3 ${i < leaders.length - 1 ? 'border-b border-white/5' : ''} ${isMe ? 'bg-brand-500/10' : ''}`}>
              <span className="text-lg w-7 text-center flex-shrink-0">{medals[i] ?? `${i + 1}`}</span>
              <Avatar uid={user.uid} name={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${isMe ? 'text-brand-400' : 'text-zinc-100'}`}>
                  {isMe ? `${user.displayName} (you)` : user.displayName}
                </p>
                <div className="h-1 bg-white/10 rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-brand-500/60 rounded-full" style={{ width: `${Math.round((user.totalPoints / maxPoints) * 100)}%` }} />
                </div>
              </div>
              <span className="text-sm font-bold text-amber-400 flex-shrink-0">{user.totalPoints} pts</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DashboardTodoWidget({ uid, rawTodos }: { uid: string; rawTodos: TodoDoc[] }) {
  const [adding,    setAdding]    = useState(false)
  const [newTitle,  setNewTitle]  = useState('')
  const [saving,    setSaving]    = useState(false)
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set())

  const todos = useMemo(
    () => rawTodos
      .filter(t => !t.isCompleted)
      .sort((a, b) => {
        if (a.category === 'urgent' && b.category !== 'urgent') return -1
        if (a.category !== 'urgent' && b.category === 'urgent') return 1
        return (a.order ?? 0) - (b.order ?? 0)
      }),
    [rawTodos],
  )

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || saving) return
    setSaving(true)
    try {
      await addDoc(collection(db, 'todos'), {
        studentId:   uid,
        title:       newTitle.trim(),
        description: '',
        category:    'todo' as TodoCategory,
        isCompleted: false,
        completedAt: null,
        createdAt:   serverTimestamp(),
        order:       todos.length,
      })
      setNewTitle('')
      setAdding(false)
    } catch (err) {
      console.error('Failed to add task:', err)
    } finally {
      setSaving(false)
    }
  }

  async function completeTask(id: string) {
    setFadingIds(prev => new Set([...prev, id]))
    setTimeout(async () => {
      await updateDoc(doc(db, 'todos', id), { isCompleted: true, completedAt: serverTimestamp() })
      setFadingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }, 600)
  }

  const visible = todos.slice(0, 6)
  const overflow = todos.length - 6

  return (
    <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="section-title flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-zinc-400" /> To-Do
        </h2>
        <Link to="/my-plan" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-0.5">
          All tasks <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Add form */}
      {adding ? (
        <form onSubmit={addTask} className="flex gap-2">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setAdding(false)}
            placeholder="Task title…"
            className="input flex-1 text-sm py-1.5"
          />
          <button type="submit" disabled={saving || !newTitle.trim()} className="btn-primary py-1.5 px-3 text-sm disabled:opacity-50">
            {saving ? '…' : 'Add'}
          </button>
          <button type="button" onClick={() => setAdding(false)} className="btn-secondary py-1.5 px-3 text-sm">✕</button>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 w-full text-sm text-zinc-500 hover:text-zinc-300 transition-colors py-1"
        >
          <Plus className="w-4 h-4" /> Add a task…
        </button>
      )}

      {/* Task list */}
      {visible.length === 0 && !adding ? (
        <p className="text-sm text-zinc-500 text-center py-4">No tasks yet.</p>
      ) : (
        <div className="space-y-2">
          {visible.map(t => {
            const fading = fadingIds.has(t.id)
            return (
              <div
                key={t.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/8 bg-zinc-800/40 transition-opacity ${fading ? 'opacity-40' : ''}`}
              >
                <button
                  onClick={() => completeTask(t.id)}
                  className="flex-shrink-0 w-5 h-5 rounded border-2 border-white/20 hover:border-emerald-500 flex items-center justify-center transition-colors"
                >
                  {fading && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                </button>
                <span className={`flex-1 text-sm text-zinc-200 ${fading ? 'line-through text-zinc-500' : ''}`}>{t.title}</span>
                {t.category === 'urgent' && (
                  <span className="text-[10px] font-bold bg-rose-950/40 text-rose-300 px-1.5 py-0.5 rounded-full border border-rose-800/50 flex-shrink-0">Urgent</span>
                )}
              </div>
            )
          })}
          {overflow > 0 && (
            <Link to="/my-plan" className="block text-xs text-zinc-500 hover:text-brand-400 transition-colors text-center py-1">
              +{overflow} more task{overflow !== 1 ? 's' : ''}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

export default function StudentDashboard() {
  const { profile, cohortId: ctxCohortId, previewCohortId } = useAuth()
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? null
  const { data: navVis } = useDocument<{ id: string; student: Record<string, boolean> }>('settings', 'nav_visibility')

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
  const activeBookings = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const food = foodOrders
      .filter(o => (o.status === 'pending' || o.status === 'confirmed') && (o.adminDate ?? o.date) >= todayStr)
      .slice(0, 3)
      .map(o => {
        const time = o.adminPickupTime ?? o.pickupTime
        return {
          id: o.id, type: 'food' as const,
          label: `Food box – ${o.adminDate ?? o.date}${time ? ` · ${time}` : ''}`,
          status: o.status,
          timeModified: !!o.pickupTimeModified,
        }
      })
    const van = minivanBookings
      .filter(b => (b.status === 'pending' || b.status === 'approved') && (b.adminDateTo ?? b.dateTo) >= todayStr)
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

  const { data: cohortStudents } = useCollection<UserDoc>(
    'users',
    cohortId ? [where('cohortId', '==', cohortId), where('role', '==', 'student')] : [],
    !!cohortId,
    cohortId ?? '',
  )
  const classPoints = useMemo(
    () => cohortStudents.reduce((sum, s) => sum + (s.totalPoints ?? 0), 0),
    [cohortStudents],
  )

  const [showLeaderboard, setShowLeaderboard] = useState(true)
  useEffect(() => {
    getDoc(doc(db, 'settings', 'experience_levels')).then(s => {
      if (s.exists()) setShowLeaderboard(s.data().showLeaderboard !== false)
    }).catch(() => {})
  }, [])

  const [todayShoot, setTodayShoot] = useState<{
    productionId: string; productionTitle: string; dayNumber: number; dayId: string; rts?: string
  } | null>(null)

  useEffect(() => {
    if (!profile?.uid) return
    const today = format(new Date(), 'yyyy-MM-dd')
    const q = query(collection(db, 'productions'), where('collaborators', 'array-contains', profile.uid))
    getDocs(q).then(async snap => {
      for (const prodDoc of snap.docs) {
        const daysSnap = await getDocs(collection(db, 'productions', prodDoc.id, 'shootingDays'))
        const todayDay = daysSnap.docs.find(d => d.data().date === today)
        if (todayDay) {
          setTodayShoot({
            productionId:   prodDoc.id,
            productionTitle: prodDoc.data()?.title ?? 'Untitled',
            dayNumber:       todayDay.data()?.dayNumber ?? 0,
            dayId:           todayDay.id,
            rts:             todayDay.data()?.rtsTime,
          })
          break
        }
      }
    }).catch(err => console.error('Today shoot query failed:', err))
  }, [profile?.uid])

  // Experience levels
  const { data: expLevelDoc } = useDocument<{ id: string; levels: { id: string; name: string; pointsRequired: number }[] }>('settings', 'experience_levels')
  const expLevels = useMemo(
    () => [...(expLevelDoc?.levels ?? [])].sort((a, b) => a.pointsRequired - b.pointsRequired),
    [expLevelDoc],
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

  if (navVis?.student?.['dashboard'] === false) {
    const firstName = profile?.displayName?.split(' ')[0] ?? profile?.email?.split('@')[0] ?? 'Student'
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
        <div className="text-5xl">🎬</div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 mb-2">Welcome, {firstName}</h1>
          <p className="text-zinc-400 text-sm max-w-xs leading-relaxed">
            Your dashboard is currently hidden. Open the menu to access your features.
          </p>
        </div>
      </div>
    )
  }

  function timeOfDay() {
    const h = now.getHours()
    if (h < 12) return 'morning'
    if (h < 17) return 'afternoon'
    return 'evening'
  }
  const firstName = profile?.displayName?.split(' ')[0]
    ?? profile?.email?.split('@')[0]
    ?? 'there'

  return (
    <div className="space-y-8">
      {/* ── Shooting today banner ───────────────────────────────────────────── */}
      {todayShoot && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-orange-400 font-semibold uppercase tracking-wide mb-0.5">Shooting today 🎬</p>
            <p className="font-bold text-white">{todayShoot.productionTitle} — Day {todayShoot.dayNumber}</p>
            {todayShoot.rts && <p className="text-sm text-zinc-400">RTS {todayShoot.rts}</p>}
          </div>
          <Link
            to={`/production/planning/${todayShoot.productionId}?tab=shotlog`}
            className="flex-shrink-0 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors whitespace-nowrap"
          >
            Shot Log →
          </Link>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-100">
            Good {timeOfDay()}, {firstName} 👋
          </h1>
          <p className="text-zinc-500 mt-1">
            {(() => {
              const day = now.getDay()
              if (day === 1) return 'New week, new scenes to shoot 🎬'
              if (day === 5) return 'Almost the weekend — great work this week! 🎉'
              return 'Keep up the great work on your filmmaking journey.'
            })()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StreakBadge days={progress?.streakDays ?? 0} />
          {navVis?.student?.['points'] !== false && (
            <PointsBadge totalPoints={profile?.totalPoints ?? 0} pointsRedeemed={profile?.pointsRedeemed ?? 0} classPoints={classPoints} />
          )}
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


      {/* ── Week at a glance ───────────────────────────────────────────────── */}
      <WeekAtAGlance lessons={lessons} assignments={assignments} />

      {/* ── Class leaderboard ──────────────────────────────────────────────── */}
      {showLeaderboard && cohortId && profile?.uid && (
        <Leaderboard cohortId={cohortId} currentUid={profile.uid} />
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
            ? <EmptyState icon={BookOpen} title="No upcoming lessons this week 📅" description="Check back when your teacher adds new ones." />
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
            ? <EmptyState icon={BookOpen} title="All caught up! 🎉" description="No pending assignments — nice work." />
            : pendingAssignments.map(a => {
                const dueDate = toDate(a.dueDate)
                const todayStr = now.toISOString().slice(0, 10)
                const dueTodayStr = dueDate?.toISOString().slice(0, 10)
                return (
                  <DeadlineCard
                    key={a.id}
                    assignment={a}
                    subjectColor={subjectMap[a.subjectId]?.color}
                    subjectTitle={subjectMap[a.subjectId]?.title}
                    isOverdue={isPast(dueDate ?? new Date())}
                    isDueToday={!isPast(dueDate ?? new Date()) && dueTodayStr === todayStr}
                  />
                )
              })
          }
        </div>
      </div>

      {/* ── Check-in status ─────────────────────────────────────────────── */}
      {profile && <CheckInStatus lessons={lessons} uid={profile.uid} />}

      {/* ── My Points ────────────────────────────────────────────────────── */}
      {profile && navVis?.student?.['points'] !== false && (() => {
        const total = profile.totalPoints ?? 0
        const redeemed = profile.pointsRedeemed ?? 0
        const available = total - redeemed
        // Custom levels (if configured), else fall back to every-100-pts system
        const hasCustomLevels = expLevels.length > 0
        const currentExpLevel = hasCustomLevels
          ? [...expLevels].reverse().find(l => total >= l.pointsRequired) ?? null
          : null
        const nextExpLevel = hasCustomLevels && currentExpLevel
          ? expLevels.find(l => l.pointsRequired > currentExpLevel.pointsRequired) ?? null
          : hasCustomLevels ? (expLevels[0] ?? null) : null
        const lvl = Math.floor(total / 100) + 1
        const progress = total % 100
        const milestone = lvl * 100
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
            <div className="flex items-end gap-6 flex-wrap">
              <div>
                <p className="text-3xl font-bold text-amber-600 tabular-nums">{available}</p>
                <p className="text-xs text-zinc-400">available</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-zinc-500 tabular-nums">{total}</p>
                <p className="text-xs text-zinc-400">earned total</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-sky-400 tabular-nums">{classPoints}</p>
                <p className="text-xs text-zinc-400">class points</p>
              </div>
              <div className="ml-auto flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-2">
                <span className="text-lg">⭐</span>
                <div>
                  <p className="text-sm font-bold text-orange-400 leading-none">
                    {hasCustomLevels ? (currentExpLevel?.name ?? expLevels[0]?.name ?? '—') : `Level ${lvl}`}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {hasCustomLevels
                      ? nextExpLevel
                        ? `${nextExpLevel.pointsRequired - total} pts to ${nextExpLevel.name}`
                        : '🏆 Max level!'
                      : `${100 - progress} pts to next`}
                  </p>
                </div>
              </div>
            </div>
            <div>
              {hasCustomLevels ? (() => {
                const from = currentExpLevel?.pointsRequired ?? 0
                const to   = nextExpLevel?.pointsRequired ?? from
                const pct  = nextExpLevel ? Math.min(100, Math.round(((total - from) / (to - from)) * 100)) : 100
                return (
                  <>
                    <div className="flex justify-between text-xs text-zinc-400 mb-1">
                      <span>{total} pts total</span>
                      {nextExpLevel && <span>Next: {nextExpLevel.name} at {nextExpLevel.pointsRequired} pts</span>}
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </>
                )
              })() : (
                <>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{progress} / 100 pts</span>
                    <span>Next level: {milestone} pts</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </>
              )}
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
      {(() => {
        const quickLinks = [
          navVis?.student?.['checkin'] !== false && { to: '/checkin', bg: 'bg-brand-600 hover:bg-brand-700', icon: '📷', label: 'Check In' },
          navVis?.student?.['booking'] !== false && { to: '/booking', bg: 'bg-sky-500 hover:bg-sky-600', icon: '🚪', label: 'Book Room' },
          navVis?.student?.['guide']   !== false && { to: '/guide',   bg: 'bg-amber-500 hover:bg-amber-600', icon: '📖', label: 'Guide' },
        ].filter(Boolean) as { to: string; bg: string; icon: string; label: string }[]
        if (!quickLinks.length) return null
        const cols = quickLinks.length === 1 ? 'grid-cols-1' : quickLinks.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
        return (
          <div>
            <h2 className="section-title mb-3">Quick Access</h2>
            <div className={`grid ${cols} gap-3`}>
              {quickLinks.map(l => (
                <Link key={l.to} to={l.to} className={`flex flex-col items-center gap-2 ${l.bg} text-white rounded-2xl p-4 transition-colors text-center`}>
                  <span className="text-2xl">{l.icon}</span>
                  <span className="text-sm font-semibold">{l.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )
      })()}

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
              const tab = b.type === 'food' ? 'food' : 'minivan'
              return (
                <Link key={b.id} to="/booking" state={{ tab, openId: b.id }} className="bg-zinc-900 rounded-xl border border-white/10 px-4 py-3 flex items-center gap-3 hover:border-brand-300 transition-colors">
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

      {/* ── To-Do widget ─────────────────────────────────────────────────── */}
      {profile && <DashboardTodoWidget uid={profile.uid} rawTodos={myTodos} />}

      {/* ── Equipment widget ───────────────────────────────────────────────── */}
      <StudentEquipmentWidget uid={profile?.uid ?? ''} />

      {/* ── Progress row ───────────────────────────────────────────────────── */}
      <div className={navVis?.student?.['subjects'] !== false ? "grid grid-cols-1 md:grid-cols-3 gap-6" : "flex justify-center"}>
        {/* Overall ring */}
        <Link to="/assignments" className="card flex flex-col items-center justify-center gap-4 hover:border-brand-500/40 transition-colors">
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
        </Link>

        {/* Subject bars */}
        {navVis?.student?.['subjects'] !== false && (
          <div className="card col-span-2 space-y-4">
            <h2 className="section-title">Progress by Subject</h2>
            {subjects.length === 0 ? (
              <p className="text-sm text-zinc-400">No subjects added yet.</p>
            ) : (
              subjects.map(subject => {
                const sp = progress?.subjectProgress?.[subject.id]
                return (
                  <Link key={subject.id} to={`/subjects/${subject.id}`} className="block hover:opacity-80 transition-opacity">
                    <XPBar
                      label={`${subject.iconEmoji} ${subject.title}`}
                      current={sp?.completed ?? 0}
                      max={sp?.total ?? 1}
                      color={subject.color ?? 'bg-brand-500'}
                    />
                  </Link>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
