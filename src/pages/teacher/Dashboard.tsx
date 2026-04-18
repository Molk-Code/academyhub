import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Users, ClipboardCheck, CalendarDays, TrendingUp, ChevronRight, Plus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { toDate, shortDate, timeStr } from '@/lib/utils'
import type { UserDoc, SubmissionDoc, LessonDoc, CohortDoc } from '@/types'
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string | number; color: string
}) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
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

  const cohortIds = cohorts.map(c => c.id)

  // Students in those cohorts
  const { data: students } = useCollection<UserDoc>(
    'users',
    [where('role', '==', 'student')],
  )

  // Submissions pending grading
  const { data: pendingSubmissions } = useCollection<SubmissionDoc>(
    'submissions',
    [where('status', '==', 'submitted'), orderBy('submittedAt', 'asc')],
  )

  // Upcoming lessons
  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    profile ? [where('teacherId', '==', profile.uid), orderBy('startTime', 'asc')] : [],
    !!profile,
  )

  const upcomingLessons = useMemo(
    () => lessons.filter(l => (toDate(l.startTime) ?? now) >= now).slice(0, 4),
    [lessons, now],
  )

  const cohortStudents = useMemo(
    () => students.filter(s => s.cohortId && cohortIds.includes(s.cohortId)),
    [students, cohortIds],
  )

  if (cohortsLoading) return <LoadingSpinner />

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">
            Welcome back, {profile?.displayName?.split(' ')[0]}
          </h1>
          <p className="text-slate-400 mt-1">Here's what needs your attention today.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/teacher/lessons/new" className="btn bg-brand-600 text-white hover:bg-brand-500 py-2.5">
            <Plus className="w-4 h-4" /> New Lesson
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users}          label="Students"         value={cohortStudents.length}       color="bg-brand-600" />
        <StatCard icon={ClipboardCheck} label="Pending Grading"  value={pendingSubmissions.length}   color="bg-amber-500" />
        <StatCard icon={CalendarDays}   label="Upcoming Lessons" value={upcomingLessons.length}      color="bg-sky-500"   />
        <StatCard icon={TrendingUp}     label="Cohorts"          value={cohorts.length}              color="bg-emerald-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending submissions */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">Submissions to Grade</h2>
            <Link to="/teacher/gradebook" className="text-sm text-brand-400 hover:text-brand-300 flex items-center gap-0.5">
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
                  className="flex items-center gap-3 p-3 bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors"
                >
                  {student && <Avatar uid={student.uid} name={student.displayName} size="sm" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {student?.displayName ?? 'Student'}
                    </p>
                    <p className="text-xs text-slate-400 truncate">Assignment submission</p>
                  </div>
                  <span className="badge badge-amber flex-shrink-0">Needs grading</span>
                </Link>
              )
            })}
            {pendingSubmissions.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">All caught up! No submissions to grade.</p>
            )}
          </div>
        </div>

        {/* Upcoming lessons */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">Your Upcoming Lessons</h2>
            <Link to="/teacher/lessons" className="text-sm text-brand-400 hover:text-brand-300 flex items-center gap-0.5">
              All lessons <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingLessons.map(lesson => (
              <div key={lesson.id} className="flex items-center gap-3 p-3 bg-slate-800 rounded-xl">
                <div className="text-center min-w-[48px]">
                  <p className="text-xs text-slate-400">{shortDate(lesson.startTime).split(' ')[0]}</p>
                  <p className="text-lg font-bold text-white">{shortDate(lesson.startTime).split(' ')[1]}</p>
                </div>
                <div className="w-px h-8 bg-slate-700" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{lesson.title}</p>
                  <p className="text-xs text-slate-400">
                    {timeStr(lesson.startTime)}–{timeStr(lesson.endTime)} · {lesson.isOnline ? 'Online' : lesson.classroom}
                  </p>
                </div>
              </div>
            ))}
            {upcomingLessons.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No upcoming lessons scheduled.</p>
            )}
          </div>
        </div>
      </div>

      {/* Student list preview */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Your Students</h2>
          <Link to="/teacher/students" className="text-sm text-brand-400 hover:text-brand-300 flex items-center gap-0.5">
            View all <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cohortStudents.slice(0, 6).map(student => (
            <Link
              key={student.uid}
              to={`/teacher/students/${student.uid}`}
              className="flex items-center gap-3 p-3 bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors"
            >
              <Avatar uid={student.uid} name={student.displayName} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{student.displayName}</p>
                <p className="text-xs text-slate-400 tabular-nums">{student.totalPoints} pts</p>
              </div>
              {!student.isActive && <span className="badge badge-rose">Inactive</span>}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
