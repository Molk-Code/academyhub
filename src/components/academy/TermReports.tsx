import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { FileText, Download, Loader2 } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useSchool } from '@/contexts/SchoolContext'
import { useDocument } from '@/hooks/useFirestore'
import type { AbsenceReportDoc, AssignmentDoc, CohortDoc, LessonDoc, PointsLogDoc, SemesterSettingsDoc, SubjectDoc, SubmissionDoc, UserDoc } from '@/types'
import { termsFor, studentTermReport, studentCsv, cohortCsv, type ReportData, type StudentTermReport } from '@/lib/termReport'
import { studentReportPdf, cohortReportPdf } from '@/lib/termReportPdf'
import { downloadFile, fileSlug, type CsvFormat } from '@/lib/csv'
import { usePlan } from '@/hooks/usePlan'
import { PlanFeatureNote } from '@/components/admin/PlanNotices'

// Term reports for one class: a summary per student and for the class, as PDF
// or CSV, as a basis for report cards. Data is read when the panel opens,
// with the reads staff already have (no new collections).

async function loadReportData(cohortId: string, studentIds: string[]): Promise<ReportData> {
  const byCohort = async <T,>(name: string) =>
    (await getDocs(query(collection(db, name), where('cohortId', '==', cohortId)))).docs.map(d => ({ id: d.id, ...d.data() }) as T)
  const [assignments, submissions, lessons, absences, subjects] = await Promise.all([
    byCohort<AssignmentDoc>('assignments'),
    byCohort<SubmissionDoc>('submissions'),
    byCohort<LessonDoc>('lessons'),
    byCohort<AbsenceReportDoc>('absence_reports'),
    getDocs(collection(db, 'subjects')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }) as SubjectDoc)),
  ])
  const checkIns = new Map<string, Set<string>>()
  for (let i = 0; i < studentIds.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'points_log'),
      where('reason', '==', 'attendance'), where('studentId', 'in', studentIds.slice(i, i + 30))))
    for (const d of snap.docs) {
      const p = d.data() as PointsLogDoc
      if (!checkIns.has(p.studentId)) checkIns.set(p.studentId, new Set())
      checkIns.get(p.studentId)!.add(p.referenceId)
    }
  }
  return { assignments, submissions, lessons, absences, checkIns, subjects: new Map(subjects.map(s => [s.id, { title: s.title }])) }
}

type Props = { cohort: CohortDoc; students: UserDoc[] }

/** On Academy Standard and up (plan features, functions/src/pricing.ts) */
export default function TermReports(props: Props) {
  return usePlan().has('academyExport') ? <TermReportsPanel {...props} /> : <PlanFeatureNote feature="academyExport" />
}

function TermReportsPanel({ cohort, students }: Props) {
  const { name: school, currency } = useSchool()
  const { data: semester } = useDocument<SemesterSettingsDoc>('settings', 'semester')
  const terms = useMemo(() => termsFor(cohort, semester), [cohort, semester])
  const [termId, setTermId] = useState('')
  const term = terms.find(t => t.id === termId) ?? terms[0]
  const [csvFormat, setCsvFormat] = useState<CsvFormat>(currency === 'SEK' ? 'sv' : 'intl')

  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sorted = useMemo(() => [...students].sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv')), [students])
  const studentKey = sorted.map(s => s.id).join(',')

  async function load() {
    setLoading(true); setError('')
    try { setData(await loadReportData(cohort.id, sorted.map(s => s.id))) }
    catch (e: any) { setError(e?.message ?? 'Could not load the reports') }
    finally { setLoading(false) }
  }
  // Loaded again when the class's students change
  useEffect(() => { setData(null) }, [cohort.id, studentKey])

  const reports: StudentTermReport[] = useMemo(
    () => data && term ? sorted.map(s => studentTermReport({ id: s.id, displayName: s.displayName, email: s.email, enrolledAt: s.enrolledAt }, data, term)) : [],
    [data, term, sorted],
  )
  const slug = (name: string) => `${fileSlug(name)}-${term ? fileSlug(term.label, 30) : ''}`

  async function savePdf(r: StudentTermReport | null) {
    try {
      const blob = r ? await studentReportPdf(r, cohort.name, school) : await cohortReportPdf(reports, cohort.name, school)
      downloadFile(`term-summary-${slug(r ? r.student.displayName : cohort.name)}.pdf`, blob)
    } catch (e: any) { setError(e?.message ?? 'Could not make the PDF') }
  }
  function saveCsv(r: StudentTermReport | null) {
    const csv = r ? studentCsv(r, cohort.name, csvFormat) : cohortCsv(reports, cohort.name, csvFormat)
    downloadFile(`term-summary-${slug(r ? r.student.displayName : cohort.name)}.csv`, csv)
  }

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-white/10 disabled:opacity-50'

  return (
    <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand-400" /> Term reports
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Grades and attendance per student and for the class, as PDF or CSV: a basis for report cards.
          Absence reasons and teacher feedback are not included.
        </p>
      </div>

      {!term ? (
        <p className="text-sm text-amber-300">Set the term dates for this class (or the school's semester dates) to make term reports.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Term" className="input w-auto text-sm" value={term.id} onChange={e => setTermId(e.target.value)}>
              {terms.map(t => <option key={t.id} value={t.id}>{t.label}: {t.start} to {t.end}</option>)}
            </select>
            <select aria-label="CSV format" className="input w-auto text-sm" value={csvFormat} onChange={e => setCsvFormat(e.target.value as CsvFormat)}>
              <option value="sv">CSV for Swedish Excel (; and 0,5)</option>
              <option value="intl">CSV, international (, and 0.5)</option>
            </select>
            {!data && (
              <button className={btn} disabled={loading || !sorted.length} onClick={load}>
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Show reports
              </button>
            )}
          </div>
          {!sorted.length && <p className="text-sm text-zinc-500">No students in this class.</p>}
          {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}

          {data && (
            <>
              <div className="flex flex-wrap gap-2">
                <button className={btn} onClick={() => savePdf(null)}><Download className="w-3.5 h-3.5" /> Class PDF</button>
                <button className={btn} onClick={() => saveCsv(null)}><Download className="w-3.5 h-3.5" /> Class CSV</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500">
                      <th className="py-2 pr-3 font-medium">Student</th>
                      <th className="py-2 pr-3 font-medium">Attendance</th>
                      <th className="py-2 pr-3 font-medium">Graded</th>
                      <th className="py-2 pr-3 font-medium">Missing</th>
                      <th className="py-2 pr-3 font-medium">Average</th>
                      <th className="py-2 font-medium sr-only">Downloads</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {reports.map(r => (
                      <tr key={r.student.id}>
                        <td className="py-2 pr-3 text-zinc-100">{r.student.displayName}</td>
                        <td className="py-2 pr-3 text-zinc-300">{r.attendance.pct == null ? '-' : `${r.attendance.pct}%`} <span className="text-zinc-500">({r.attendance.attended}/{r.attendance.lessons})</span></td>
                        <td className="py-2 pr-3 text-zinc-300">{r.totals.graded}/{r.totals.assignments}</td>
                        <td className="py-2 pr-3 text-zinc-300">{r.totals.missing}</td>
                        <td className="py-2 pr-3 text-zinc-300">{r.totals.averagePct == null ? '-' : `${r.totals.averagePct}%`}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button className={btn} aria-label={`PDF for ${r.student.displayName}`} onClick={() => savePdf(r)}>PDF</button>{' '}
                          <button className={btn} aria-label={`CSV for ${r.student.displayName}`} onClick={() => saveCsv(r)}>CSV</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
