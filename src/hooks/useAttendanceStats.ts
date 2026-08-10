import { useMemo } from 'react'
import { isAfter, isBefore, startOfDay, format } from 'date-fns'
import { useCollection, where } from '@/hooks/useFirestore'
import type { LessonDoc, PointsLogDoc, CohortDoc } from '@/types'

export interface AttendanceLessonRow {
  id: string
  title: string
  date: string
  startTime?: string
  endTime?: string
  attended: boolean
}

export interface AttendanceStats {
  total: number
  attended: number
  absent: number
  attendancePct: number
  absencePct: number
  lessons: AttendanceLessonRow[]
}

export function useAttendanceStats(uid: string | null, cohortId: string | null): AttendanceStats | null {
  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
  )
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const { data: checkIns } = useCollection<PointsLogDoc>(
    'points_log',
    uid ? [where('studentId', '==', uid), where('reason', '==', 'attendance')] : [],
    !!uid,
  )

  const myCohort = useMemo(
    () => cohorts.find(c => c.id === cohortId) ?? null,
    [cohorts, cohortId],
  )

  return useMemo(() => {
    if (!myCohort?.startDate) return null
    const today = startOfDay(new Date())
    const yearStart = myCohort.startDate.toDate()
    const yearEnd = myCohort.endDate
      ? myCohort.endDate.toDate()
      : new Date(yearStart.getFullYear() + 1, yearStart.getMonth(), yearStart.getDate())

    const effectiveEnd = isAfter(today, yearEnd) ? yearEnd : today

    const scheduledLessons = lessons.filter(l => {
      const d = l.startTime?.toDate?.()
      if (!d) return false
      return !isBefore(d, yearStart) && !isAfter(d, effectiveEnd)
    })

    const attendedIds = new Set(checkIns.map(c => c.referenceId))
    const total = scheduledLessons.length
    const attendedCount = Math.min(scheduledLessons.filter(l => attendedIds.has(l.id)).length, total)
    const absent = total - attendedCount
    const attendancePct = total > 0 ? Math.round((attendedCount / total) * 100) : 0
    const absencePct = total > 0 ? Math.round((absent / total) * 100) : 0

    const sorted = [...scheduledLessons].sort((a, b) => {
      const da = a.startTime?.toDate?.()?.getTime() ?? 0
      const db_ = b.startTime?.toDate?.()?.getTime() ?? 0
      return da - db_
    })
    const lessonRows: AttendanceLessonRow[] = sorted.map(l => ({
      id: l.id,
      title: l.title,
      date: l.startTime?.toDate?.()?.toLocaleDateString('sv-SE') ?? '',
      startTime: l.startTime?.toDate ? format(l.startTime.toDate(), 'HH:mm') : undefined,
      endTime:   l.endTime?.toDate   ? format(l.endTime.toDate(),   'HH:mm') : undefined,
      attended: attendedIds.has(l.id),
    }))

    return { total, attended: attendedCount, absent, attendancePct, absencePct, lessons: lessonRows }
  }, [myCohort, lessons, checkIns])
}
