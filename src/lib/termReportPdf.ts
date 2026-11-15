import { format } from 'date-fns'
import type { StudentTermReport } from './termReport'

// Term summaries as PDF (jsPDF, like the other exports): one student, or a
// class with a row per student. A basis for a report card, not a grade
// document of its own.

const pct = (n: number | null) => n == null ? '-' : `${n}%`
const STATUS: Record<string, string> = { graded: 'Graded', submitted: 'Submitted, not graded', missing: 'Missing', 'not due': 'Not due yet' }
const NOTE = 'Scores are from assignments and tests in CineForge; the best graded attempt counts. Attendance counts lessons that require presence, '
  + 'from enrolment up to the day of export. This summary is a basis for a report card, not an official grade.'

async function pdf(orientation: 'portrait' | 'landscape' = 'portrait') {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  return { doc: new jsPDF({ orientation }), autoTable }
}

function header(doc: any, title: string, school: string, lines: [string, string][]) {
  const right = doc.internal.pageSize.getWidth() - 14
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text(title, 14, 18)
  doc.setFontSize(11); doc.text(school, right, 18, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
  let y = 27
  for (const [k, v] of lines) {
    doc.setTextColor(110, 110, 110); doc.text(k, 14, y)
    doc.setTextColor(0, 0, 0); doc.text(v, 50, y)
    y += 5.5
  }
  return y
}

function footnote(doc: any, y: number) {
  const width = doc.internal.pageSize.getWidth() - 28
  if (y > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 20 }
  doc.setFontSize(8); doc.setTextColor(100, 100, 100)
  doc.text(doc.splitTextToSize(NOTE, width), 14, y)
  doc.setTextColor(0, 0, 0)
}

const TABLE = { styles: { fontSize: 8.5, cellPadding: 1.8 }, headStyles: { fillColor: [40, 40, 48] as [number, number, number] } }

export async function studentReportPdf(r: StudentTermReport, cohortName: string, school: string): Promise<Blob> {
  const { doc, autoTable } = await pdf()
  let y = header(doc, 'Term summary', school, [
    ['Student', r.student.displayName],
    ['Class', cohortName],
    ['Term', `${r.term.label}, ${r.term.start} to ${r.term.end}`],
    ['Exported', format(new Date(), 'yyyy-MM-dd')],
  ])

  const a = r.attendance, t = r.totals
  autoTable(doc, {
    ...TABLE, startY: y + 2,
    head: [['Attendance', 'Lessons', 'Present', 'Absent', 'Reported absences', 'Assignments', 'Graded', 'Passed', 'Missing', 'Average']],
    body: [[pct(a.pct), a.lessons, a.attended, a.absent, a.reported, t.assignments, t.graded, t.passed, t.missing, pct(t.averagePct)].map(String)],
  })
  y = (doc as any).lastAutoTable.finalY + 8

  if (r.subjects.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Per subject', 14, y); doc.setFont('helvetica', 'normal')
    autoTable(doc, {
      ...TABLE, startY: y + 3,
      head: [['Subject', 'Assignments', 'Graded', 'Passed', 'Average']],
      body: r.subjects.map(s => [s.subject, s.assignments, s.graded, s.passed, pct(s.averagePct)].map(String)),
    })
    y = (doc as any).lastAutoTable.finalY + 8

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Assignments', 14, y); doc.setFont('helvetica', 'normal')
    autoTable(doc, {
      ...TABLE, startY: y + 3,
      head: [['Subject', 'Assignment', 'Due', 'Status', 'Score', 'Result', 'Passed']],
      body: r.grades.map(g => [
        g.subject, g.title, g.due, STATUS[g.status],
        g.score != null && g.maxScore ? `${g.score} / ${g.maxScore}` : '', g.percent == null ? '' : `${g.percent}%`,
        g.passed == null ? '' : g.passed ? 'Yes' : 'No',
      ]),
    })
    y = (doc as any).lastAutoTable.finalY + 8
  }

  const missed = r.lessons.filter(l => !l.attended)
  if (missed.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Absences', 14, y); doc.setFont('helvetica', 'normal')
    autoTable(doc, {
      ...TABLE, startY: y + 3,
      head: [['Date', 'Subject', 'Lesson', 'Reported']],
      body: missed.map(l => [l.date, l.subject, l.title, l.reported ? 'Yes' : 'No']),
    })
    y = (doc as any).lastAutoTable.finalY + 8
  }
  footnote(doc, y)
  return doc.output('blob')
}

export async function cohortReportPdf(reports: StudentTermReport[], cohortName: string, school: string): Promise<Blob> {
  const { doc, autoTable } = await pdf('landscape')
  const term = reports[0]?.term
  const y = header(doc, 'Class term summary', school, [
    ['Class', cohortName],
    ['Term', term ? `${term.label}, ${term.start} to ${term.end}` : '-'],
    ['Students', String(reports.length)],
    ['Exported', format(new Date(), 'yyyy-MM-dd')],
  ])
  const subjects = [...new Set(reports.flatMap(r => r.subjects.map(s => s.subject)))].sort((a, b) => a.localeCompare(b, 'sv'))
  autoTable(doc, {
    ...TABLE, startY: y + 2,
    head: [['Student', 'Attendance', 'Absent', 'Reported', 'Graded', 'Passed', 'Missing', 'Average', ...subjects]],
    body: reports.map(r => [
      r.student.displayName, pct(r.attendance.pct), r.attendance.absent, r.attendance.reported,
      `${r.totals.graded} / ${r.totals.assignments}`, r.totals.passed, r.totals.missing, pct(r.totals.averagePct),
      ...subjects.map(s => pct(r.subjects.find(x => x.subject === s)?.averagePct ?? null)),
    ].map(String)),
  })
  footnote(doc, (doc as any).lastAutoTable.finalY + 8)
  return doc.output('blob')
}
