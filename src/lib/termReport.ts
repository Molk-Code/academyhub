import type { AbsenceReportDoc, AssignmentDoc, AssignmentType, CohortDoc, LessonDoc, SemesterSettingsDoc, SubmissionDoc } from '@/types'
import { toCsv, type CsvFormat } from './csv'

// Grades and attendance for one student or a whole class over a term, as a
// basis for a report card (PDF in termReportPdf.ts, or CSV). Attendance counts
// the lessons that require presence, from the student's enrolment up to today,
// like the student's own attendance view. Absence reasons and teacher feedback
// are left out: only whether an absence was reported.

type Stamp = { toDate(): Date } | null | undefined

export const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const stampDay = (t: Stamp) => { const d = t?.toDate?.(); return d ? day(d) : '' }

export interface Term { id: string; label: string; start: string; end: string }

const season = (start: string) => {
  const d = new Date(`${start}T12:00:00`)
  return `${d.getMonth() >= 6 ? 'Autumn' : 'Spring'} ${d.getFullYear()}`
}

/** Term 1, term 2 (the class's dates, else the school's) and the whole class period */
export function termsFor(cohort: Pick<CohortDoc, 'startDate' | 'endDate' | 'semesterStartDate' | 'semesterEndDate' | 'semesterSem2StartDate' | 'semesterSem2EndDate'>, school?: SemesterSettingsDoc | null): Term[] {
  const terms: Term[] = []
  const s1 = { start: cohort.semesterStartDate ?? school?.startDate, end: cohort.semesterEndDate ?? school?.endDate }
  const s2 = { start: cohort.semesterSem2StartDate ?? school?.sem2Start, end: cohort.semesterSem2EndDate ?? school?.sem2End }
  if (s1.start && s1.end) terms.push({ id: 's1', label: `Term 1 (${season(s1.start)})`, start: s1.start, end: s1.end })
  if (s2.start && s2.end) terms.push({ id: 's2', label: `Term 2 (${season(s2.start)})`, start: s2.start, end: s2.end })
  const from = stampDay(cohort.startDate), to = stampDay(cohort.endDate)
  if (from && to) terms.push({ id: 'year', label: 'Whole class period', start: from, end: to })
  return terms
}

export interface ReportData {
  subjects: Map<string, { title: string }>
  assignments: AssignmentDoc[]
  submissions: SubmissionDoc[]
  lessons: LessonDoc[]
  /** studentId → lesson ids checked in to (points_log, reason 'attendance') */
  checkIns: Map<string, Set<string>>
  absences: AbsenceReportDoc[]
}

export interface ReportStudent { id: string; displayName: string; email?: string; enrolledAt?: Stamp }

export type GradeStatus = 'graded' | 'submitted' | 'missing' | 'not due'

export interface GradeRow {
  assignmentId: string
  subject: string
  title: string
  type: AssignmentType
  due: string
  status: GradeStatus
  score: number | null
  maxScore: number | null
  percent: number | null
  passed: boolean | null
}

export interface SubjectSummary { subject: string; assignments: number; graded: number; passed: number; averagePct: number | null }

export interface LessonRow { lessonId: string; date: string; subject: string; title: string; attended: boolean; reported: boolean }

export interface StudentTermReport {
  student: ReportStudent
  term: Term
  grades: GradeRow[]
  subjects: SubjectSummary[]
  lessons: LessonRow[]
  attendance: { lessons: number; attended: number; absent: number; reported: number; pct: number | null }
  totals: { assignments: number; graded: number; passed: number; missing: number; averagePct: number | null }
}

const avg = (ns: number[]) => ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length * 10) / 10 : null
const inTerm = (d: string, t: Term) => !!d && d >= t.start && d <= t.end

const percentOf = (s: SubmissionDoc) =>
  s.percentageScore ?? (s.score != null && s.maxScore ? Math.round(s.score / s.maxScore * 1000) / 10 : null)

/** The attempt that counts: the best graded one, else the latest submitted */
function counting(subs: SubmissionDoc[]): SubmissionDoc | undefined {
  const graded = subs.filter(s => s.status === 'graded')
  if (graded.length) return graded.reduce((a, b) => (percentOf(b) ?? -1) > (percentOf(a) ?? -1) ? b : a)
  const submitted = subs.filter(s => s.status === 'submitted')
  return submitted.reduce<SubmissionDoc | undefined>((a, b) => !a || (b.attemptNumber ?? 0) > (a.attemptNumber ?? 0) ? b : a, undefined)
}

export function studentTermReport(student: ReportStudent, data: ReportData, term: Term, today = day(new Date())): StudentTermReport {
  const subjectName = (id: string) => data.subjects.get(id)?.title ?? 'Other'
  const mine = data.submissions.filter(s => s.studentId === student.id)

  const grades: GradeRow[] = data.assignments
    .filter(a => a.isPublished && inTerm(stampDay(a.dueDate), term))
    .map(a => {
      const sub = counting(mine.filter(s => s.assignmentId === a.id))
      const due = stampDay(a.dueDate)
      const status: GradeStatus = sub?.status === 'graded' ? 'graded' : sub ? 'submitted' : due < today ? 'missing' : 'not due'
      const graded = status === 'graded'
      return {
        assignmentId: a.id, subject: subjectName(a.subjectId), title: a.title, type: a.type, due, status,
        score: graded ? sub!.score : null, maxScore: graded ? sub!.maxScore : null,
        percent: graded ? percentOf(sub!) : null, passed: graded ? sub!.passed : null,
      }
    })
    .sort((a, b) => a.subject.localeCompare(b.subject, 'sv') || a.due.localeCompare(b.due))

  const bySubject = new Map<string, GradeRow[]>()
  for (const g of grades) bySubject.set(g.subject, [...(bySubject.get(g.subject) ?? []), g])
  const summarize = (subject: string, rows: GradeRow[]): SubjectSummary => ({
    subject, assignments: rows.length,
    graded: rows.filter(r => r.status === 'graded').length,
    passed: rows.filter(r => r.passed === true).length,
    averagePct: avg(rows.flatMap(r => r.percent == null ? [] : [r.percent])),
  })
  const subjects = [...bySubject].map(([s, rows]) => summarize(s, rows))

  // Attendance: lessons requiring presence, from enrolment to today
  const enrolled = stampDay(student.enrolledAt)
  const until = today < term.end ? today : term.end
  const attended = data.checkIns.get(student.id) ?? new Set<string>()
  const myAbsences = data.absences.filter(r => r.studentId === student.id)
  const lessons: LessonRow[] = data.lessons
    .filter(l => l.requiresPresence !== false)
    .map(l => ({ l, date: stampDay(l.startTime) }))
    .filter(({ date }) => date >= term.start && date <= until && (!enrolled || date >= enrolled))
    .sort((a, b) => (a.l.startTime?.toDate?.().getTime() ?? 0) - (b.l.startTime?.toDate?.().getTime() ?? 0))
    .map(({ l, date }) => {
      const here = attended.has(l.id)
      const reported = !here && myAbsences.some(r => r.date === date && (r.type === 'full_day' || r.lessonId === l.id))
      return { lessonId: l.id, date, subject: subjectName(l.subjectId), title: l.title, attended: here, reported }
    })
  const present = lessons.filter(l => l.attended).length
  const t = summarize('', grades)

  return {
    student, term, grades, subjects, lessons,
    attendance: {
      lessons: lessons.length, attended: present, absent: lessons.length - present,
      reported: lessons.filter(l => l.reported).length,
      pct: lessons.length ? Math.round(present / lessons.length * 1000) / 10 : null,
    },
    totals: { assignments: t.assignments, graded: t.graded, passed: t.passed, missing: grades.filter(g => g.status === 'missing').length, averagePct: t.averagePct },
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────────

/** One student: a row per assignment and per lesson */
export function studentCsv(r: StudentTermReport, cohortName: string, format: CsvFormat): string {
  const head = ['Student', 'Class', 'Term', 'Kind', 'Date', 'Subject', 'Title', 'Type', 'Status', 'Score', 'Max score', 'Percent', 'Passed', 'Attended', 'Absence reported']
  const base = [r.student.displayName, cohortName, r.term.label]
  return toCsv([
    head,
    ...r.grades.map(g => [...base, 'assignment', g.due, g.subject, g.title, g.type, g.status, g.score, g.maxScore, g.percent, g.passed, null, null]),
    ...r.lessons.map(l => [...base, 'lesson', l.date, l.subject, l.title, null, l.attended ? 'present' : 'absent', null, null, null, null, l.attended, l.attended ? null : l.reported]),
  ], format)
}

/** A class: one row per student, with the average per subject */
export function cohortCsv(reports: StudentTermReport[], cohortName: string, format: CsvFormat): string {
  const subjects = [...new Set(reports.flatMap(r => r.subjects.map(s => s.subject)))].sort((a, b) => a.localeCompare(b, 'sv'))
  const head = ['Student', 'Email', 'Class', 'Term', 'From', 'To', 'Lessons', 'Attended', 'Absent', 'Absences reported', 'Attendance %',
    'Assignments', 'Graded', 'Passed', 'Missing', 'Average %', ...subjects.map(s => `${s} average %`)]
  return toCsv([
    head,
    ...reports.map(r => [
      r.student.displayName, r.student.email, cohortName, r.term.label, r.term.start, r.term.end,
      r.attendance.lessons, r.attendance.attended, r.attendance.absent, r.attendance.reported, r.attendance.pct,
      r.totals.assignments, r.totals.graded, r.totals.passed, r.totals.missing, r.totals.averagePct,
      ...subjects.map(s => r.subjects.find(x => x.subject === s)?.averagePct ?? null),
    ]),
  ], format)
}
