import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument, useCollection, where } from '@/hooks/useFirestore'
import type { UserDoc, CohortDoc, AbsenceReportDoc, ProgressDoc } from '@/types'
import { ArrowLeft, Check, AlertTriangle, UserCheck, UserX, ClipboardList } from 'lucide-react'
import Avatar from '@/components/common/Avatar'
import XPBar from '@/components/dashboard/XPBar'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { format } from 'date-fns'

export default function StudentDetail() {
  const { uid } = useParams<{ uid: string }>()

  const { data: student, loading } = useDocument<UserDoc>('users', uid)
  const { data: cohort }           = useDocument<CohortDoc>('cohorts', student?.cohortId ?? undefined)
  const { data: progressDocs }     = useCollection<ProgressDoc & { id: string }>('progress', uid ? [where('studentId', '==', uid)] : [], !!uid, uid ?? '')
  const progressDoc = progressDocs[0] ?? null

  const { data: absencesRaw } = useCollection<AbsenceReportDoc>(
    'absence_reports',
    uid ? [where('studentId', '==', uid)] : [],
    !!uid,
    uid ?? '',
  )

  const absences = useMemo(
    () => [...absencesRaw].sort((a, b) =>
      (b.reportedAt?.toMillis?.() ?? 0) - (a.reportedAt?.toMillis?.() ?? 0)
    ),
    [absencesRaw],
  )

  const byYear = useMemo(() => {
    const groups: Record<string, AbsenceReportDoc[]> = {}
    for (const r of absences) {
      const year = r.date?.slice(0, 4) ?? 'Unknown'
      if (!groups[year]) groups[year] = []
      groups[year].push(r)
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
  }, [absences])

  async function markReviewed(id: string) {
    await updateDoc(doc(db, 'absence_reports', id), { status: 'reviewed' })
  }

  if (loading) return <LoadingSpinner />
  if (!student) return (
    <div className="text-center py-20">
      <p className="text-zinc-500">Student not found.</p>
      <Link to="/teacher/students" className="text-brand-600 text-sm mt-2 inline-block">← Back to Students</Link>
    </div>
  )

  const pendingCount = absences.filter(r => r.status === 'pending').length

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back */}
      <Link to="/teacher/students" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Students
      </Link>

      {/* Student header */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 flex items-center gap-4 flex-wrap">
        <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-zinc-100">{student.displayName}</h1>
            {student.isActive
              ? <span className="badge badge-green"><UserCheck className="w-3 h-3" /> Active</span>
              : <span className="badge badge-rose"><UserX className="w-3 h-3" /> Inactive</span>
            }
          </div>
          <p className="text-sm text-zinc-500">{student.email}</p>
          {cohort && <p className="text-xs text-zinc-400 mt-0.5">{cohort.name}</p>}
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-center">
            <p className={`text-2xl font-bold ${(student.totalPoints ?? 0) < 0 ? 'text-rose-500' : 'text-amber-500'}`}>
              {student.totalPoints ?? 0}
            </p>
            <p className="text-xs text-zinc-400">Points</p>
          </div>
          {progressDoc && (
            <div className="text-center">
              <p className="text-2xl font-bold text-brand-600">{progressDoc.overallPercentage}%</p>
              <p className="text-xs text-zinc-400">Progress</p>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {progressDoc && (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-3">Course Progress</h2>
          <XPBar
            current={progressDoc.completedAssignments}
            max={progressDoc.totalAssignments ?? 1}
            color="bg-brand-500"
          />
          <p className="text-xs text-zinc-400 mt-1.5">
            {progressDoc.completedAssignments} of {progressDoc.totalAssignments} assignments completed
          </p>
        </div>
      )}

      {/* Development Plan */}
      <Link
        to={`/teacher/students/${uid}/plan`}
        className="bg-zinc-900 border border-white/10 rounded-2xl p-5 flex items-center gap-4 hover:border-brand-300 hover:shadow-sm transition-all"
      >
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
          <ClipboardList className="w-5 h-5 text-brand-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-zinc-100">Individual Development Plan</p>
          <p className="text-xs text-zinc-400 mt-0.5">View NOPRA plan and leave feedback</p>
        </div>
        <ArrowLeft className="w-4 h-4 text-zinc-400 rotate-180 flex-shrink-0" />
      </Link>

      {/* Absence history */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h2 className="text-base font-semibold text-zinc-200">Absence History</h2>
          <span className="text-sm text-zinc-400">{absences.length} total</span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
              {pendingCount} pending
            </span>
          )}
        </div>

        {absences.length === 0 ? (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-10 text-center">
            <p className="text-zinc-400 text-sm">No absence reports on record.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {byYear.map(([year, reports]) => (
              <div key={year}>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">{year}</p>
                <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden divide-y divide-slate-100">
                  {reports.map(r => (
                    <div key={r.id} className="flex items-start gap-3 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-200 font-mono">{r.date}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            r.type === 'full_day' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {r.type === 'full_day' ? 'Full day' : 'Lesson'}
                          </span>
                          {r.lessonTitle && (
                            <span className="text-xs text-zinc-500">{r.lessonTitle}</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">{r.reason}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-900/40 text-amber-300'
                        }`}>
                          {r.status === 'reviewed' ? 'Reviewed' : 'Pending'}
                        </span>
                        {r.status === 'pending' && (
                          <button
                            onClick={() => markReviewed(r.id)}
                            className="p-1.5 text-zinc-400 hover:text-emerald-600 rounded-lg hover:bg-emerald-50 transition-colors"
                            title="Mark as reviewed"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
