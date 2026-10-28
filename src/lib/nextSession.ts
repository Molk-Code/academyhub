import type { LessonDoc, SyncedEventDoc } from '@/types'
import { toDate } from '@/lib/utils'

export interface SubjectSession {
  title: string
  start: Date
  place: string | null   // 'Online', a classroom/location, or null
}

// A subject's sessions are its native lessons plus synced Outlook events
// tagged with the subject (e.g. a guest teacher's session).
export function subjectSessions(lessons: LessonDoc[], syncedEvents: SyncedEventDoc[]): SubjectSession[] {
  const out: SubjectSession[] = []
  for (const l of lessons) {
    const start = toDate(l.startTime)
    if (start) out.push({ title: l.title, start, place: l.isOnline ? 'Online' : (l.classroom || null) })
  }
  for (const e of syncedEvents) {
    const start = toDate(e.startTime)
    if (!start) continue
    out.push({
      title: e.customTitle || e.title,
      start,
      place: e.isOnline ? 'Online' : (e.classroom || e.customLocation || e.location || null),
    })
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

export function nextSubjectSession(lessons: LessonDoc[], syncedEvents: SyncedEventDoc[], now = new Date()) {
  return subjectSessions(lessons, syncedEvents).find(s => s.start > now) ?? null
}
