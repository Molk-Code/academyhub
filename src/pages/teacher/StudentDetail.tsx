import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument, useCollection, where } from '@/hooks/useFirestore'
import type { UserDoc, CohortDoc, AbsenceReportDoc, ProgressDoc, LessonDoc, SubjectDoc } from '@/types'
import {
  ArrowLeft, Check, AlertTriangle, UserCheck, UserX, ClipboardList,
  MessageSquare, ChevronDown, CheckCircle2, XCircle, BookOpen,
} from 'lucide-react'
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { format } from 'date-fns'

export default function StudentDetail() {
  const { uid } = useParams<{ uid: string }>()
  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(null)

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

  // Lessons for the student's cohort
  const { data: cohortLessons } = useCollection<LessonDoc>(
    'lessons',
    student?.cohortId ? [where('cohortId', '==', student.cohortId)] : [],
    !!student?.cohortId,
    `lessons-${student?.cohortId ?? ''}`,
  )

  // All subjects (small collection, fine to fetch all)
  const { data: allSubjects } = useCollection<SubjectDoc>('subjects')

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

  // Per-subject curriculum progress for this student
  const curriculumBySubject = useMemo(() => {
    if (!allSubjects.length || !cohortLessons.length) return []

    const now = new Date()
    const absentLessonIds = new Set(
      absencesRaw.map(r => r.lessonId).filter(Boolean) as string[]
    )

    // Past lessons grouped by subjectId that have covered curriculum items
    const lessonsBySubject: Record<string, LessonDoc[]> = {}
    for (const l of cohortLessons) {
      const lessonDate = l.startTime?.toDate?.()
      if (!lessonDate || lessonDate > now) continue
      if (!l.coveredCurriculumIds?.length) continue
      if (!lessonsBySubject[l.subjectId]) lessonsBySubject[l.subjectId] = []
      lessonsBySubject[l.subjectId].push(l)
    }

    return allSubjects
      .filter(s => lessonsBySubject[s.id] && s.curriculum?.length > 0)
      .map(subject => {
        const lessons  = lessonsBySubject[subject.id]
        const curriculum = [...(subject.curriculum ?? [])].sort((a, b) => a.order - b.order)

        const coveredIds = new Set<string>()
        const missedIds  = new Set<string>()

        for (const l of lessons) {
          for (const cid of (l.coveredCurriculumIds ?? [])) {
            coveredIds.add(cid)
            if (absentLessonIds.has(l.id)) missedIds.add(cid)
          }
        }

        // "Completed" = covered AND not missed
        const completedIds = new Set([...coveredIds].filter(id => !missedIds.has(id)))

        return { subject, curriculum, coveredIds, missedIds, completedIds }
      })
      .filter(s => s.coveredIds.size > 0)
      .sort((a, b) => (a.subject.programYear - b.subject.programYear) || (a.subject.order - b.subject.order))
  }, [allSubjects, cohortLessons, absencesRaw])

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
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
        {/* Row 1: avatar + identity + message button */}
        <div className="flex items-start gap-4">
          <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="lg" enlargeable />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-zinc-100">{student.displayName}</h1>
              {student.isActive
                ? <span className="badge badge-green"><UserCheck className="w-3 h-3" /> Active</span>
                : <span className="badge badge-rose"><UserX className="w-3 h-3" /> Inactive</span>
              }
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">{student.email}</p>
            {cohort && <p className="text-xs text-zinc-400 mt-0.5">{cohort.name}</p>}
          </div>
          <Link
            to={`/teacher/chat?dm=${student.uid}`}
            className="flex-shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Message</span>
          </Link>
        </div>

        {/* Row 2: stats */}
        <div className="flex items-center gap-6 pt-3 border-t border-white/8">
          <div>
            <p className={`text-2xl font-bold ${(student.totalPoints ?? 0) < 0 ? 'text-rose-500' : 'text-amber-500'}`}>
              {student.totalPoints ?? 0}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">Total points</p>
          </div>
          {progressDoc && (
            <div>
              <p className="text-2xl font-bold text-brand-400">{progressDoc.overallPercentage}%</p>
              <p className="text-xs text-zinc-400 mt-0.5">Course progress</p>
            </div>
          )}
          {progressDoc && (
            <div className="flex-1">
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all"
                  style={{ width: `${progressDoc.overallPercentage}%` }}
                />
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {progressDoc.completedAssignments} / {progressDoc.totalAssignments} assignments
              </p>
            </div>
          )}
        </div>
      </div>


      {/* Curriculum progress per subject */}
      {curriculumBySubject.length > 0 && (
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <BookOpen className="w-4 h-4 text-brand-400" />
            <h2 className="text-base font-semibold text-zinc-200">Curriculum Progress</h2>
          </div>
          <div className="space-y-2">
            {curriculumBySubject.map(({ subject, curriculum, coveredIds, missedIds, completedIds }) => {
              const isExpanded = expandedSubjectId === subject.id
              const total     = curriculum.length
              const completed = completedIds.size
              const missed    = missedIds.size
              const pct       = total > 0 ? Math.round((completed / total) * 100) : 0

              return (
                <div key={subject.id} className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
                  {/* Subject header — click to expand */}
                  <button
                    onClick={() => setExpandedSubjectId(isExpanded ? null : subject.id)}
                    className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/5 transition-colors text-left"
                  >
                    <span className="text-xl flex-shrink-0">{subject.iconEmoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-100">{subject.title}</p>
                        {missed > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded-full">
                            <XCircle className="w-3 h-3" /> {missed} missed
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${subject.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-zinc-400 flex-shrink-0">
                          {completed}/{total} · {pct}%
                        </span>
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-zinc-500 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Expanded curriculum list */}
                  {isExpanded && (
                    <div className="border-t border-white/8">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/8">
                            <th className="w-8 px-4 py-2" />
                            <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-2">Topic</th>
                            <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-2 hidden sm:table-cell">Content</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {curriculum.map(item => {
                            const isMissed    = missedIds.has(item.id)
                            const isCompleted = completedIds.has(item.id)
                            const isCovered   = coveredIds.has(item.id)
                            return (
                              <tr
                                key={item.id}
                                className={`${isMissed ? 'bg-rose-500/10' : isCompleted ? 'bg-emerald-500/10' : ''}`}
                              >
                                <td className="px-4 py-2.5 text-center">
                                  {isMissed
                                    ? <XCircle className="w-4 h-4 text-rose-500 mx-auto" />
                                    : isCompleted
                                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                                      : <span className="w-4 h-4 block mx-auto rounded-full border border-zinc-700" />
                                  }
                                </td>
                                <td className={`px-4 py-2.5 text-sm font-medium ${isMissed ? 'text-rose-300' : isCompleted ? 'text-emerald-300' : 'text-zinc-400'}`}>
                                  {item.title}
                                  {!isCovered && <span className="ml-2 text-xs text-zinc-600 font-normal">not yet covered</span>}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-zinc-500 hidden sm:table-cell">{item.content}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
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
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400">
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
                <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/5">
                  {reports.map(r => (
                    <div key={r.id} className="flex items-start gap-3 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-200 font-mono">{r.date}</span>
                          {(r.lessonStartTime || r.lessonEndTime) && (
                            <span className="text-xs font-mono text-zinc-400">
                              {r.lessonStartTime ?? '?'}
                              {r.lessonEndTime ? `–${r.lessonEndTime}` : ''}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            r.type === 'full_day' ? 'bg-amber-500/20 text-amber-400' : 'bg-sky-500/20 text-sky-400'
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
                          r.status === 'reviewed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-900/40 text-amber-300'
                        }`}>
                          {r.status === 'reviewed' ? 'Reviewed' : 'Pending'}
                        </span>
                        {r.status === 'pending' && (
                          <button
                            onClick={() => markReviewed(r.id)}
                            className="p-1.5 text-zinc-400 hover:text-emerald-400 rounded-lg hover:bg-emerald-500/10 transition-colors"
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
