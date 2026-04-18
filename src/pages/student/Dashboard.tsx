import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { isPast } from 'date-fns'
import { BookOpen, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useMyProgress } from '@/hooks/useProgress'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { toDate } from '@/lib/utils'
import type { LessonDoc, AssignmentDoc, SubjectDoc, SubmissionDoc } from '@/types'
import ProgressRing     from '@/components/dashboard/ProgressRing'
import XPBar            from '@/components/dashboard/XPBar'
import PointsBadge      from '@/components/dashboard/PointsBadge'
import StreakBadge      from '@/components/dashboard/StreakBadge'
import { LessonCard, DeadlineCard } from '@/components/dashboard/UpcomingCard'
import LoadingSpinner   from '@/components/common/LoadingSpinner'
import EmptyState       from '@/components/common/EmptyState'

export default function StudentDashboard() {
  const { profile, cohortId } = useAuth()
  const { data: progress, loading: progressLoading } = useMyProgress()

  const now = new Date()

  // Upcoming lessons (next 7 days)
  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    cohortId
      ? [where('cohortId', '==', cohortId), orderBy('startTime', 'asc')]
      : [],
    !!cohortId,
  )

  // Assignments
  const { data: assignments } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId
      ? [where('cohortId', '==', cohortId), orderBy('dueDate', 'asc')]
      : [],
    !!cohortId,
  )

  // Student's own submissions
  const { data: submissions } = useCollection<SubmissionDoc>(
    'submissions',
    profile
      ? [where('studentId', '==', profile.uid)]
      : [],
    !!profile,
  )

  // Subjects for colour lookup
  const { data: subjects } = useCollection<SubjectDoc>('subjects')

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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            {greeting()}, {profile?.displayName?.split(' ')[0]} 👋
          </h1>
          <p className="text-slate-500 mt-1">Keep up the great work on your filmmaking journey.</p>
        </div>
        <div className="flex items-center gap-3">
          <StreakBadge days={progress?.streakDays ?? 0} />
          <PointsBadge points={profile?.totalPoints ?? 0} />
        </div>
      </div>

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
            <p className="text-sm font-semibold text-slate-700">Course Progress</p>
            <p className="text-xs text-slate-400">
              {progress?.completedAssignments ?? 0} of {progress?.totalAssignments ?? 0} assignments done
            </p>
          </div>
        </div>

        {/* Subject bars */}
        <div className="card col-span-2 space-y-4">
          <h2 className="section-title">Progress by Subject</h2>
          {subjects.length === 0 ? (
            <p className="text-sm text-slate-400">No subjects added yet.</p>
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
    </div>
  )
}
