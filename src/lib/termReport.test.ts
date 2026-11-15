import { describe, it, expect } from 'vitest'
import type { AbsenceReportDoc, AssignmentDoc, LessonDoc, SubmissionDoc } from '@/types'
import { termsFor, studentTermReport, studentCsv, cohortCsv, type ReportData, type Term } from './termReport'

const at = (d: string, time = '09:00') => ({ toDate: () => new Date(`${d}T${time}:00`) }) as any
const term: Term = { id: 's1', label: 'Term 1 (Autumn 2026)', start: '2026-08-20', end: '2026-12-20' }
const today = '2026-11-15'

const assignment = (id: string, subjectId: string, due: string, extra: Partial<AssignmentDoc> = {}) =>
  ({ id, subjectId, cohortId: 'c1', title: id, type: 'test', dueDate: at(due), isPublished: true, ...extra }) as AssignmentDoc
const sub = (assignmentId: string, studentId: string, extra: Partial<SubmissionDoc>) =>
  ({ id: `${assignmentId}-${studentId}-${extra.attemptNumber ?? 1}`, assignmentId, studentId, status: 'graded', score: null, maxScore: 10, percentageScore: null, passed: null, attemptNumber: 1, ...extra }) as SubmissionDoc
const lesson = (id: string, subjectId: string, d: string, extra: Partial<LessonDoc> = {}) =>
  ({ id, subjectId, title: id, startTime: at(d), ...extra }) as LessonDoc

const data: ReportData = {
  subjects: new Map([['cam', { title: 'Camera' }], ['edit', { title: 'Editing' }]]),
  assignments: [
    assignment('a1', 'cam', '2026-09-10'),
    assignment('a2', 'cam', '2026-10-01', { type: 'practical' }),
    assignment('a3', 'edit', '2026-10-15'),
    assignment('a4', 'edit', '2026-12-01'),                       // not due yet
    assignment('a5', 'edit', '2026-10-20', { isPublished: false }), // hidden
    assignment('a6', 'edit', '2027-02-01'),                        // next term
  ],
  submissions: [
    sub('a1', 'kim', { score: 6, percentageScore: 60, passed: true, attemptNumber: 1 }),
    sub('a1', 'kim', { score: 9, percentageScore: 90, passed: true, attemptNumber: 2 }),
    sub('a2', 'kim', { status: 'submitted', attemptNumber: 1 }),
    sub('a3', 'sam', { score: 4, maxScore: 8, passed: false }),
  ],
  lessons: [
    lesson('l1', 'cam', '2026-09-01'),
    lesson('l2', 'cam', '2026-09-08'),
    lesson('l3', 'edit', '2026-09-15'),
    lesson('l4', 'edit', '2026-09-16', { requiresPresence: false }),
    lesson('l5', 'edit', '2026-11-20'),   // after today
    lesson('l6', 'cam', '2026-08-01'),    // before the term
  ],
  checkIns: new Map([['kim', new Set(['l1', 'l3'])], ['sam', new Set(['l1', 'l2', 'l3'])]]),
  absences: [{ studentId: 'kim', date: '2026-09-08', type: 'full_day' } as AbsenceReportDoc],
}

describe('term report', () => {
  it('terms: the class dates win over the school dates', () => {
    const t = termsFor({ startDate: at('2026-08-15'), endDate: at('2027-06-10'), semesterStartDate: '2026-08-20', semesterEndDate: '2026-12-20' } as any,
      { id: 'semester', startDate: '2026-08-25', endDate: '2026-12-18', sem2Start: '2027-01-08', sem2End: '2027-06-05' })
    expect(t.map(x => [x.id, x.start, x.end, x.label])).toEqual([
      ['s1', '2026-08-20', '2026-12-20', 'Term 1 (Autumn 2026)'],
      ['s2', '2027-01-08', '2027-06-05', 'Term 2 (Spring 2027)'],
      ['year', '2026-08-15', '2027-06-10', 'Whole class period'],
    ])
  })

  it('grades: the best graded attempt counts; missing, submitted and not due', () => {
    const r = studentTermReport({ id: 'kim', displayName: 'Kim' }, data, term, today)
    expect(r.grades.map(g => [g.assignmentId, g.status, g.percent])).toEqual([
      ['a1', 'graded', 90], ['a2', 'submitted', null], ['a3', 'missing', null], ['a4', 'not due', null],
    ])
    expect(r.totals).toEqual({ assignments: 4, graded: 1, passed: 1, missing: 1, averagePct: 90 })
    expect(r.subjects).toEqual([
      { subject: 'Camera', assignments: 2, graded: 1, passed: 1, averagePct: 90 },
      { subject: 'Editing', assignments: 2, graded: 0, passed: 0, averagePct: null },
    ])
    const sam = studentTermReport({ id: 'sam', displayName: 'Sam' }, data, term, today)
    expect(sam.grades.find(g => g.assignmentId === 'a3')).toMatchObject({ percent: 50, passed: false })
  })

  it('attendance: lessons requiring presence, in the term, up to today, from enrolment', () => {
    const r = studentTermReport({ id: 'kim', displayName: 'Kim' }, data, term, today)
    expect(r.lessons.map(l => [l.lessonId, l.attended, l.reported])).toEqual([['l1', true, false], ['l2', false, true], ['l3', true, false]])
    expect(r.attendance).toEqual({ lessons: 3, attended: 2, absent: 1, reported: 1, pct: 66.7 })
    const late = studentTermReport({ id: 'kim', displayName: 'Kim', enrolledAt: at('2026-09-10') }, data, term, today)
    expect(late.attendance).toMatchObject({ lessons: 1, attended: 1, pct: 100 })
  })

  it('CSV per student and per class', () => {
    const kim = studentTermReport({ id: 'kim', displayName: 'Kim', email: 'kim@example.test' }, data, term, today)
    const sam = studentTermReport({ id: 'sam', displayName: 'Sam' }, data, term, today)
    const s = studentCsv(kim, 'Film 1', 'sv').replace('﻿', '').trim().split('\r\n')
    expect(s).toHaveLength(1 + 4 + 3)
    expect(s[1]).toBe('Kim;Film 1;Term 1 (Autumn 2026);assignment;2026-09-10;Camera;a1;test;graded;9;10;90;yes;;')
    expect(s[6]).toBe('Kim;Film 1;Term 1 (Autumn 2026);lesson;2026-09-08;Camera;l2;;absent;;;;;no;yes')
    const c = cohortCsv([kim, sam], 'Film 1', 'intl').trim().split('\r\n')
    expect(c[0].endsWith('Average %,Camera average %,Editing average %')).toBe(true)
    expect(c[1]).toBe('Kim,kim@example.test,Film 1,Term 1 (Autumn 2026),2026-08-20,2026-12-20,3,2,1,1,66.7,4,1,1,1,90,90,')
    expect(c[2].endsWith(',3,3,0,0,100,4,1,0,2,50,,50')).toBe(true)
  })
})
