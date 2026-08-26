import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, deleteDoc, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { isToday, format } from 'date-fns'
import { Search, ChevronRight, UserCheck, UserX, AlertTriangle, Check, CalendarPlus, X, Trash2, BookOpen, Download } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, where, orderBy } from '@/hooks/useFirestore'
import { toDate } from '@/lib/utils'
import type { UserDoc, CohortDoc, ProgressDoc, LessonDoc, AbsenceReportDoc } from '@/types'
import Avatar from '@/components/common/Avatar'
import XPBar from '@/components/dashboard/XPBar'
import LoadingSpinner from '@/components/common/LoadingSpinner'

interface AddAbsenceState {
  student: UserDoc
  date: string
  type: 'full_day' | 'lesson'
  lessonId: string
  reason: string
  submitting: boolean
}

interface AttendanceSettingsDoc { id: string; pointsPerCheckIn: number; absencePenalty?: number }

type TabId = 'students' | 'lesson-absences' | 'student-absences'

export default function Students() {
  const { profile: teacherProfile } = useAuth()
  const [search,         setSearch]         = useState('')
  const [selectedCohort, setSelectedCohort] = useState('')
  const [activeTab,      setActiveTab]      = useState<TabId>('students')

  const [addAbsence, setAddAbsence] = useState<AddAbsenceState | null>(null)

  const [attendanceMap, setAttendanceMap] = useState<Record<string, Set<string>>>({})

  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const { data: students, loading } = useCollection<UserDoc>('users', [where('role', '==', 'student')])
  const { data: progressDocs } = useCollection<ProgressDoc & { id: string }>('progress')
  const { data: allLessons } = useCollection<LessonDoc>('lessons')
  const { data: absenceReports } = useCollection<AbsenceReportDoc>('absence_reports', [orderBy('reportedAt', 'desc')])
  const { data: attendanceSettings } = useDocument<AttendanceSettingsDoc>('settings', 'attendance')

  const absencePenalty = attendanceSettings?.absencePenalty ?? -5

  const progressMap = Object.fromEntries(progressDocs.map(p => [p.studentId, p]))
  const pendingCount = absenceReports.filter(r => r.status === 'pending').length
  const lessonMap = useMemo(
    () => Object.fromEntries(allLessons.map(l => [l.id, l])),
    [allLessons],
  )

  function lessonTime(r: AbsenceReportDoc): { start?: string; end?: string } {
    const start = r.lessonStartTime ?? (r.lessonId ? (() => {
      const l = lessonMap[r.lessonId!]
      return l?.startTime?.toDate ? format(l.startTime.toDate(), 'HH:mm') : undefined
    })() : undefined)
    const end = r.lessonEndTime ?? (r.lessonId ? (() => {
      const l = lessonMap[r.lessonId!]
      return l?.endTime?.toDate ? format(l.endTime.toDate(), 'HH:mm') : undefined
    })() : undefined)
    return { start, end }
  }

  const latestLessonByCohort = useMemo(() => {
    const map: Record<string, LessonDoc> = {}
    for (const l of allLessons) {
      const d = toDate(l.startTime)
      if (!d || !isToday(d)) continue
      const existing = map[l.cohortId]
      if (!existing || (l.startTime?.toMillis() ?? 0) > (existing.startTime?.toMillis() ?? 0)) {
        map[l.cohortId] = l
      }
    }
    return map
  }, [allLessons])

  const lessonIdKey = Object.values(latestLessonByCohort).map(l => l.id).sort().join(',')

  useEffect(() => {
    const lessons = Object.values(latestLessonByCohort)
    if (lessons.length === 0) { setAttendanceMap({}); return }
    const unsubs = lessons.map(lesson =>
      onSnapshot(collection(db, 'lessons', lesson.id, 'attendance'), snap => {
        setAttendanceMap(prev => ({ ...prev, [lesson.id]: new Set(snap.docs.map(d => d.id)) }))
      })
    )
    return () => unsubs.forEach(u => u())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonIdKey])

  async function markReviewed(reportId: string) {
    await updateDoc(doc(db, 'absence_reports', reportId), { status: 'reviewed' })
  }

  async function deleteReport(reportId: string) {
    await deleteDoc(doc(db, 'absence_reports', reportId))
  }

  function openAddAbsence(student: UserDoc) {
    setAddAbsence({ student, date: format(new Date(), 'yyyy-MM-dd'), type: 'full_day', lessonId: '', reason: '', submitting: false })
  }

  const modalLessonsOnDate = useMemo(() => {
    if (!addAbsence) return []
    return allLessons.filter(l => {
      const d = l.startTime?.toDate?.()
      if (!d) return false
      return format(d, 'yyyy-MM-dd') === addAbsence.date && l.cohortId === addAbsence.student.cohortId
    }).sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0))
  }, [addAbsence?.date, addAbsence?.student?.cohortId, allLessons])

  async function submitTeacherAbsence() {
    if (!addAbsence || !addAbsence.reason.trim()) return
    if (addAbsence.type === 'lesson' && !addAbsence.lessonId) return
    if (addAbsence.date > format(new Date(), 'yyyy-MM-dd')) return
    setAddAbsence(prev => prev ? { ...prev, submitting: true } : null)
    try {
      const lesson = addAbsence.type === 'lesson'
        ? modalLessonsOnDate.find(l => l.id === addAbsence.lessonId)
        : undefined
      const studentUid = addAbsence.student.uid
      const lessonStartTime = lesson?.startTime?.toDate ? format(lesson.startTime.toDate(), 'HH:mm') : undefined
      const lessonEndTime   = lesson?.endTime?.toDate   ? format(lesson.endTime.toDate(),   'HH:mm') : undefined
      await addDoc(collection(db, 'absence_reports'), {
        studentId: studentUid,
        studentName: addAbsence.student.displayName,
        cohortId: addAbsence.student.cohortId ?? '',
        date: addAbsence.date,
        type: addAbsence.type,
        lessonId: lesson?.id ?? null,
        lessonTitle: lesson?.title ?? null,
        ...(lessonStartTime ? { lessonStartTime } : {}),
        ...(lessonEndTime   ? { lessonEndTime }   : {}),
        reason: addAbsence.reason.trim(),
        reportedAt: serverTimestamp(),
        status: 'reviewed',
      })
      setAddAbsence(null)
      if (absencePenalty !== 0) {
        httpsCallable(functions, 'awardPoints')({
          studentId: studentUid,
          points: absencePenalty,
          reason: 'absence_penalty',
          referenceId: lesson?.id ?? addAbsence.date,
        }).catch(() => {})
      }
    } catch {
      setAddAbsence(prev => prev ? { ...prev, submitting: false } : null)
    }
  }

  // ── Absence by lesson grouping ────────────────────────────────────────────────
  const lessonAbsenceGroups = useMemo(() => {
    const cohortFiltered = selectedCohort
      ? absenceReports.filter(r => r.cohortId === selectedCohort)
      : absenceReports
    const withLesson = cohortFiltered.filter(r => r.lessonId)
    const groups: Record<string, { lessonId: string; lessonTitle: string; date: string; startTime?: string; endTime?: string; reports: AbsenceReportDoc[] }> = {}
    for (const r of withLesson) {
      const key = r.lessonId!
      if (!groups[key]) {
        const liveLes = lessonMap[key]
        const startTime = r.lessonStartTime ?? (liveLes?.startTime?.toDate ? format(liveLes.startTime.toDate(), 'HH:mm') : undefined)
        const endTime   = r.lessonEndTime   ?? (liveLes?.endTime?.toDate   ? format(liveLes.endTime.toDate(),   'HH:mm') : undefined)
        groups[key] = { lessonId: key, lessonTitle: r.lessonTitle ?? key, date: r.date, startTime, endTime, reports: [] }
      }
      groups[key].reports.push(r)
    }
    return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date))
  }, [absenceReports, selectedCohort])

  async function clearLessonGroup(lessonId: string) {
    if (!confirm('Delete all absence reports for this lesson? This cannot be undone.')) return
    const batch = writeBatch(db)
    absenceReports.filter(r => r.lessonId === lessonId).forEach(r => {
      batch.delete(doc(db, 'absence_reports', r.id))
    })
    await batch.commit()
  }

  const filteredAbsences = (selectedCohort ? absenceReports.filter(r => r.cohortId === selectedCohort) : absenceReports)

  // Derive teacher's cohort scope from lessons (same pattern as Dashboard)
  const teacherCohortIds = useMemo(() => {
    const fromCohorts = cohorts.filter(c => c.teacherIds?.includes(teacherProfile?.uid ?? '')).map(c => c.id)
    const fromLessons = allLessons
      .filter(l => l.teacherIds?.includes(teacherProfile?.uid ?? ''))
      .map(l => l.cohortId).filter(Boolean) as string[]
    return new Set([...fromCohorts, ...fromLessons])
  }, [cohorts, allLessons, teacherProfile?.uid])

  const filtered = students
    .filter(s => s.cohortId && (teacherCohortIds.size === 0 || teacherCohortIds.has(s.cohortId)))
    .filter(s => !selectedCohort || s.cohortId === selectedCohort)
    .filter(s =>
      s.displayName.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  const hasAnyLessonToday = Object.keys(latestLessonByCohort).length > 0

  async function exportLessonAbsencesPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF()
    doc.setFontSize(14)
    doc.text('Absence by Lesson', 14, 18)
    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text(`Exported ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 14, 25)
    let y = 32
    for (const group of lessonAbsenceGroups) {
      const timeStr = group.startTime ? ` · ${group.startTime}${group.endTime ? `–${group.endTime}` : ''}` : ''
      doc.setFontSize(11)
      doc.setTextColor(30)
      doc.text(`${group.lessonTitle} — ${group.date}${timeStr}`, 14, y)
      y += 4
      autoTable(doc, {
        startY: y,
        head: [['Student', 'Reason', 'Status']],
        body: group.reports.map(r => [r.studentName, r.reason, r.status === 'reviewed' ? 'Reviewed' : 'Pending']),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [60, 60, 80] },
        margin: { left: 14, right: 14 },
      })
      y = (doc as any).lastAutoTable.finalY + 8
      if (y > 260) { doc.addPage(); y = 18 }
    }
    doc.save(`absence-by-lesson-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
  }

  async function exportAbsenceReportsPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF()
    doc.setFontSize(14)
    doc.text('Absence Report Overview', 14, 18)
    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text(`Exported ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 14, 25)
    const source = selectedCohort ? filteredAbsences : absenceReports
    const byCohort: Record<string, { name: string; rows: AbsenceReportDoc[] }> = {}
    for (const r of source) {
      if (!byCohort[r.cohortId]) {
        const cohortName = cohorts.find(c => c.id === r.cohortId)?.name ?? r.cohortId
        byCohort[r.cohortId] = { name: cohortName, rows: [] }
      }
      byCohort[r.cohortId].rows.push(r)
    }
    let y = 32
    for (const cohortId of Object.keys(byCohort)) {
      const { name, rows } = byCohort[cohortId]
      doc.setFontSize(11)
      doc.setTextColor(30)
      doc.text(`${name} (${rows.length} absences)`, 14, y)
      y += 4
      autoTable(doc, {
        startY: y,
        head: [['Student', 'Date', 'Time', 'Type', 'Lesson', 'Reason']],
        body: rows.map(r => [
          r.studentName,
          r.date,
          (() => { const { start, end } = lessonTime(r); return start ? `${start}${end ? `–${end}` : ''}` : '—' })(),
          r.type === 'full_day' ? 'Full day' : 'Lesson',
          r.lessonTitle ?? '—',
          r.reason,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [60, 60, 80] },
        columnStyles: { 5: { cellWidth: 50 } },
        margin: { left: 14, right: 14 },
      })
      y = (doc as any).lastAutoTable.finalY + 8
      if (y > 260) { doc.addPage(); y = 18 }
    }
    doc.save(`absence-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
  }

  if (loading) return <LoadingSpinner />

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'students', label: 'Students', count: filtered.length },
    { id: 'lesson-absences', label: 'Absence by Lesson', count: lessonAbsenceGroups.length },
    { id: 'student-absences', label: 'Absence Reports', count: pendingCount > 0 ? pendingCount : undefined },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Students</h1>
        <p className="text-zinc-400 text-sm mt-1">{filtered.length} students</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search students…"
            className="input pl-9"
          />
        </div>
        <select
          value={selectedCohort}
          onChange={e => setSelectedCohort(e.target.value)}
          className="input max-w-[200px]"
        >
          <option value="">All classes</option>
          {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800 p-1 rounded-xl w-fit overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-zinc-900 text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab.id ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-700 text-zinc-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Students tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'students' && (
        <>
          {/* Mobile card grid */}
          <div className="grid grid-cols-2 gap-3 sm:hidden">
            {filtered.map(student => {
              const progress    = progressMap[student.uid]
              const cohort      = cohorts.find(c => c.id === student.cohortId)
              const todayLesson = student.cohortId ? latestLessonByCohort[student.cohortId] : undefined
              const attendees   = todayLesson ? attendanceMap[todayLesson.id] : undefined
              const isPresent   = attendees !== undefined ? attendees.has(student.uid) : undefined
              return (
                <Link
                  key={student.uid}
                  to={`/teacher/students/${student.uid}`}
                  className="bg-zinc-900 border border-white/10 rounded-2xl p-4 flex flex-col gap-3 active:bg-zinc-900/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" enlargeable />
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                      student.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {student.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-100 truncate">{student.displayName}</p>
                    <p className="text-xs text-zinc-400 truncate">{cohort?.name ?? '—'}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <XPBar
                        current={progress?.completedAssignments ?? 0}
                        max={progress?.totalAssignments ?? 1}
                        color="bg-brand-500"
                      />
                    </div>
                    <span className={`text-xs font-bold flex-shrink-0 ${(student.totalPoints ?? 0) < 0 ? 'text-rose-500' : 'text-amber-600'}`}>
                      {student.totalPoints ?? 0}p
                    </span>
                  </div>
                  {hasAnyLessonToday && (
                    <div className="flex items-center gap-1">
                      {isPresent === true  && <span className="badge badge-green text-[10px]">Present</span>}
                      {isPresent === false && <span className="badge badge-rose text-[10px]">Absent</span>}
                    </div>
                  )}
                </Link>
              )
            })}
            {filtered.length === 0 && (
              <p className="col-span-2 text-center text-zinc-400 text-sm py-12">No students found.</p>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs font-medium text-zinc-500 px-5 py-3">Student</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3">Class</th>
                  <th className="text-left text-xs font-medium text-zinc-500 px-4 py-3 w-40">Progress</th>
                  <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">Points</th>
                  {hasAnyLessonToday && (
                    <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">Today</th>
                  )}
                  <th className="text-right text-xs font-medium text-zinc-500 px-4 py-3">Status</th>
                  <th className="w-20 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map(student => {
                  const progress    = progressMap[student.uid]
                  const cohort      = cohorts.find(c => c.id === student.cohortId)
                  const todayLesson = student.cohortId ? latestLessonByCohort[student.cohortId] : undefined
                  const attendees   = todayLesson ? attendanceMap[todayLesson.id] : undefined
                  const isPresent   = attendees !== undefined ? attendees.has(student.uid) : undefined

                  return (
                    <tr key={student.uid} className="hover:bg-white/5 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" enlargeable />
                          <div>
                            <p className="text-sm font-medium text-zinc-100">{student.displayName}</p>
                            <p className="text-xs text-zinc-500">{student.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-zinc-400">{cohort?.name ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <XPBar
                          current={progress?.completedAssignments ?? 0}
                          max={progress?.totalAssignments ?? 1}
                          color="bg-brand-500"
                        />
                        <p className="text-xs text-zinc-400 mt-0.5">{progress?.overallPercentage ?? 0}%</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-semibold ${(student.totalPoints ?? 0) < 0 ? 'text-rose-500' : 'text-amber-600'}`}>
                          {student.totalPoints}
                        </span>
                      </td>
                      {hasAnyLessonToday && (
                        <td className="px-4 py-3 text-right">
                          {isPresent === true  && <span className="badge badge-green">Present</span>}
                          {isPresent === false && <span className="badge badge-rose">Absent</span>}
                          {isPresent === undefined && <span className="text-zinc-300 text-xs">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        {student.isActive
                          ? <span className="badge badge-green"><UserCheck className="w-3 h-3" /> Active</span>
                          : <span className="badge badge-rose"><UserX className="w-3 h-3" /> Inactive</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openAddAbsence(student)}
                            title="Log absence"
                            className="p-1.5 text-zinc-400 hover:text-amber-600 transition-colors rounded-lg hover:bg-amber-500/10"
                          >
                            <CalendarPlus className="w-4 h-4" />
                          </button>
                          <Link
                            to={`/teacher/students/${student.uid}`}
                            className="p-1.5 text-zinc-400 hover:text-zinc-300 transition-colors rounded-lg hover:bg-zinc-800"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-center text-zinc-400 text-sm py-12">No students found.</p>
            )}
          </div>
        </>
      )}

      {/* ── Absence by Lesson tab ─────────────────────────────────────────────── */}
      {activeTab === 'lesson-absences' && (
        <div className="space-y-4">
          {lessonAbsenceGroups.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={exportLessonAbsencesPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-300 hover:text-zinc-100 border border-white/15 hover:bg-zinc-800 transition-colors"
              >
                <Download className="w-4 h-4" /> Export PDF
              </button>
            </div>
          )}
          {lessonAbsenceGroups.length === 0 ? (
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-10 text-center">
              <BookOpen className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">No lesson-specific absence reports yet.</p>
            </div>
          ) : (
            lessonAbsenceGroups.map(group => (
              <div key={group.lessonId} className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 bg-zinc-950/60">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-brand-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">{group.lessonTitle}</p>
                      <p className="text-xs text-zinc-400">
                        {group.date}
                        {group.startTime && ` · ${group.startTime}${group.endTime ? `–${group.endTime}` : ''}`}
                        {` · ${group.reports.length} absent`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => clearLessonGroup(group.lessonId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-rose-400 hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear
                  </button>
                </div>
                <div className="divide-y divide-white/5">
                  {group.reports.map(r => (
                    <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-100">{r.studentName}</p>
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{r.reason}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        r.status === 'reviewed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-900/40 text-amber-300'
                      }`}>
                        {r.status === 'reviewed' ? 'Reviewed' : 'Pending'}
                      </span>
                      {r.status === 'pending' && (
                        <button
                          onClick={() => markReviewed(r.id)}
                          className="p-1.5 text-zinc-400 hover:text-emerald-600 rounded-lg hover:bg-emerald-500/10 transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Absence Reports tab ───────────────────────────────────────────────── */}
      {activeTab === 'student-absences' && (
        <div>
          {filteredAbsences.length > 0 && (
            <div className="flex justify-end mb-3">
              <button
                onClick={exportAbsenceReportsPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-zinc-300 hover:text-zinc-100 border border-white/15 hover:bg-zinc-800 transition-colors"
              >
                <Download className="w-4 h-4" /> Export PDF
              </button>
            </div>
          )}
          {filteredAbsences.length === 0 ? (
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-10 text-center">
              <AlertTriangle className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">No absence reports yet.</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-white/8 bg-zinc-950/50">
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-5 py-3">Student</th>
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Date</th>
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Type</th>
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Lesson</th>
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Reason</th>
                    <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredAbsences.map(r => (
                    <tr key={r.id} className={`hover:bg-white/5 transition-colors ${r.status === 'pending' ? 'bg-amber-500/10' : ''}`}>
                      <td className="px-5 py-3 text-sm font-medium text-zinc-100 whitespace-nowrap">{r.studentName}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-sm text-zinc-400 font-mono">{r.date}</p>
                        {(() => { const { start, end } = lessonTime(r); return start ? (
                          <p className="text-xs text-zinc-500 font-mono mt-0.5">
                            {start}{end ? `–${end}` : ''}
                          </p>
                        ) : null })()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.type === 'full_day' ? 'bg-amber-500/20 text-amber-400' : 'bg-sky-500/20 text-sky-400'
                        }`}>
                          {r.type === 'full_day' ? 'Full day' : 'Lesson'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-500 max-w-[140px] truncate hidden md:table-cell">
                        {r.lessonTitle ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400 max-w-[200px] hidden lg:table-cell">
                        <p className="line-clamp-2">{r.reason}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.status === 'reviewed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-900/40 text-amber-300'
                        }`}>
                          {r.status === 'reviewed' ? 'Reviewed' : 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {r.status === 'pending' && (
                            <button
                              onClick={() => markReviewed(r.id)}
                              title="Mark as reviewed"
                              className="p-1.5 text-zinc-400 hover:text-emerald-600 transition-colors rounded-lg hover:bg-emerald-500/10"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteReport(r.id)}
                            title="Delete"
                            className="p-1.5 text-zinc-400 hover:text-rose-500 transition-colors rounded-lg hover:bg-rose-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Log Absence Modal */}
      {addAbsence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2">
                <CalendarPlus className="w-5 h-5 text-amber-500" />
                <h2 className="font-semibold text-zinc-100">Log Absence</h2>
              </div>
              <button onClick={() => setAddAbsence(null)} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-xl">
                <Avatar uid={addAbsence.student.uid} name={addAbsence.student.displayName} size="sm" />
                <div>
                  <p className="text-sm font-medium text-zinc-100">{addAbsence.student.displayName}</p>
                  <p className="text-xs text-zinc-500">{cohorts.find(c => c.id === addAbsence.student.cohortId)?.name ?? '—'}</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Date</label>
                <input
                  type="date"
                  value={addAbsence.date}
                  onChange={e => setAddAbsence(prev => prev ? { ...prev, date: e.target.value, lessonId: '' } : null)}
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Type</label>
                <div className="flex gap-2">
                  {(['full_day', 'lesson'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setAddAbsence(prev => prev ? { ...prev, type: t, lessonId: '' } : null)}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                        addAbsence.type === t
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-zinc-900 border-white/15 text-zinc-400 hover:border-amber-400'
                      }`}
                    >
                      {t === 'full_day' ? 'Full Day' : 'Specific Lesson'}
                    </button>
                  ))}
                </div>
              </div>

              {addAbsence.type === 'lesson' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Lesson</label>
                  {modalLessonsOnDate.length === 0 ? (
                    <p className="text-xs text-zinc-400 px-1">No lessons found on {addAbsence.date}.</p>
                  ) : (
                    <select
                      value={addAbsence.lessonId}
                      onChange={e => setAddAbsence(prev => prev ? { ...prev, lessonId: e.target.value } : null)}
                      className="input w-full"
                    >
                      <option value="">Select a lesson…</option>
                      {modalLessonsOnDate.map(l => {
                        const t = l.startTime?.toDate?.()
                        const tEnd = l.endTime?.toDate?.()
                        return (
                          <option key={l.id} value={l.id}>
                            {t ? format(t, 'HH:mm') : ''}{tEnd ? `–${format(tEnd, 'HH:mm')}` : ''} — {l.title}
                          </option>
                        )
                      })}
                    </select>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Reason *</label>
                <textarea
                  value={addAbsence.reason}
                  onChange={e => setAddAbsence(prev => prev ? { ...prev, reason: e.target.value } : null)}
                  rows={2}
                  className="input w-full resize-none"
                  placeholder="Reason for absence…"
                />
              </div>

              {absencePenalty !== 0 && (
                <p className="text-xs text-rose-400 bg-rose-950/40 rounded-lg px-3 py-2">
                  This will apply a {absencePenalty > 0 ? '+' : ''}{absencePenalty} point adjustment to the student.
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setAddAbsence(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/15 text-zinc-400 text-sm font-medium hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitTeacherAbsence}
                  disabled={
                    addAbsence.submitting ||
                    !addAbsence.reason.trim() ||
                    (addAbsence.type === 'lesson' && !addAbsence.lessonId) ||
                    addAbsence.date > format(new Date(), 'yyyy-MM-dd')
                  }
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium text-sm transition-colors"
                >
                  {addAbsence.date > format(new Date(), 'yyyy-MM-dd') ? 'Future date' : addAbsence.submitting ? 'Saving…' : 'Log Absence'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
