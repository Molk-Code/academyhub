import { useState, useMemo, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { deleteDoc, updateDoc, doc, Timestamp, collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, where, orderBy } from '@/hooks/useFirestore'
import { shortDate, timeStr, toDate } from '@/lib/utils'
import type { LessonDoc, SubjectDoc, CohortDoc, LessonBlockDoc, SemesterSettingsDoc, LessonCategoryDoc, UserDoc, PersonalEventDoc, SyncedEventDoc, GuestTeacherDoc } from '@/types'
import { Plus, Pencil, Trash2, CalendarDays, List, X, QrCode, Circle, SlidersHorizontal, ChevronDown, Check, MapPin } from 'lucide-react'
import { markCalendarInvitesSeen } from '@/hooks/useCalendarInviteBadge'
import AnnualPlanWheel from '@/components/calendar/AnnualPlanWheel'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import EmptyState     from '@/components/common/EmptyState'
import { useAttendance } from '@/contexts/AttendanceContext'
import FullCalendar   from '@fullcalendar/react'
import dayGridPlugin  from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput } from '@fullcalendar/core'

// ── Semester marker helper ────────────────────────────────────────────────────

function semesterMarkers(dates: {
  sem1Start?: string; sem1End?: string
  sem2Start?: string; sem2End?: string
}, label = ''): EventInput[] {
  const prefix = label ? `${label}: ` : ''
  const mk = (id: string, title: string, date: string, color: string): EventInput => ({
    id,
    title: `${prefix}${title}`,
    start: date,
    allDay: true,
    backgroundColor: color,
    borderColor: color,
    textColor: '#fff',
    editable: false,
    extendedProps: { isSemesterMarker: true },
  })
  const out: EventInput[] = []
  if (dates.sem1Start) out.push(mk(`sm-s1s-${label}-${dates.sem1Start}`, '🎓 Semester 1 — Start', dates.sem1Start, '#10b981'))
  if (dates.sem1End)   out.push(mk(`sm-s1e-${label}-${dates.sem1End}`,   '🏁 Semester 1 — End',   dates.sem1End,   '#f59e0b'))
  if (dates.sem2Start) out.push(mk(`sm-s2s-${label}-${dates.sem2Start}`, '🎓 Semester 2 — Start', dates.sem2Start, '#10b981'))
  if (dates.sem2End)   out.push(mk(`sm-s2e-${label}-${dates.sem2End}`,   '🏁 Semester 2 — End',   dates.sem2End,   '#f59e0b'))
  return out
}

const COHORT_FALLBACK_COLORS = [
  '#f26419','#33658a','#10b981','#8b5cf6','#f6ae2d',
  '#f43f5e','#0ea5e9','#14b8a6','#86bbd8','#e879f9',
]

type ViewId = 'timeGridWorkWeek' | 'timeGridWeek' | 'dayGridMonth' | 'timeGridDay'
const MOBILE_VIEWS: { id: ViewId; label: string }[] = [
  { id: 'timeGridWorkWeek', label: 'Work week' },
  { id: 'timeGridWeek',     label: 'Week'      },
  { id: 'dayGridMonth',     label: 'Month'     },
  { id: 'timeGridDay',      label: 'Day'       },
]

interface SelectedLesson {
  id: string
  title: string
  subjectTitle?: string
  className?: string
  cohortId?: string
  start?: Date
  end?: Date
  color: string
  classroom?: string
  isOnline?: boolean
}

function LessonAttendance({ lessonId, cohortId }: { lessonId: string; cohortId?: string }) {
  const { data: cohortStudents } = useCollection<UserDoc>(
    'users',
    cohortId ? [where('cohortId', '==', cohortId), where('role', '==', 'student')] : [],
    !!cohortId,
  )
  const [attendees, setAttendees] = useState<{ studentId: string; displayName: string; checkedInAt: any }[]>([])

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'lessons', lessonId, 'attendance'),
      snap => setAttendees(snap.docs.map(d => d.data() as any)),
    )
    return unsub
  }, [lessonId])

  const checkedInSet = useMemo(() => new Set(attendees.map(a => a.studentId)), [attendees])
  const absent = useMemo(() => cohortStudents.filter(s => !checkedInSet.has(s.uid)), [cohortStudents, checkedInSet])
  const sorted = useMemo(
    () => [...attendees].sort((a, b) => (a.checkedInAt?.toMillis?.() ?? 0) - (b.checkedInAt?.toMillis?.() ?? 0)),
    [attendees],
  )

  return (
    <div className="border-t border-white/8 pt-4 space-y-2">
      <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2 flex-wrap">
        <span>👥 Attendance</span>
        <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full">
          {attendees.length} checked in
        </span>
        {absent.length > 0 && (
          <span className="bg-rose-100 text-rose-600 text-xs px-2 py-0.5 rounded-full">
            {absent.length} absent
          </span>
        )}
      </h3>
      {attendees.length === 0 && absent.length === 0 ? (
        <p className="text-sm text-zinc-400 italic">No check-ins yet</p>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {sorted.map(a => (
            <li key={a.studentId} className="flex items-center gap-2 text-sm">
              <span className="text-emerald-500">✅</span>
              <span className="font-medium text-zinc-200">{a.displayName}</span>
              <span className="text-zinc-400 text-xs ml-auto tabular-nums">
                {a.checkedInAt?.toDate
                  ? a.checkedInAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''}
              </span>
            </li>
          ))}
          {absent.map(s => (
            <li key={s.uid} className="flex items-center gap-2 text-sm">
              <span className="text-rose-400">❌</span>
              <span className="font-medium text-zinc-500">{s.displayName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface DayDetail {
  date: Date
  dateStr: string
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const y1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - y1.getTime()) / 86400000 + 1) / 7)
}

interface SchoolDayDoc { id: string; startTime: string; endTime: string }

export default function Lessons() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const { startAttendance } = useAttendance()
  const [showGhostBlocks,       setShowGhostBlocks]       = useState(true)
  const [editingSyncedEvent,    setEditingSyncedEvent]    = useState<SyncedEventDoc | null>(null)
  const [syncedEditLocation,    setSyncedEditLocation]    = useState('')
  const [syncedEditNotes,       setSyncedEditNotes]       = useState('')
  const [syncedEditTeachers,    setSyncedEditTeachers]    = useState<string[]>([])
  const [syncedEditGuestTeachers, setSyncedEditGuestTeachers] = useState<string[]>([])
  const [savingSyncedEdit,      setSavingSyncedEdit]      = useState(false)
  const [view,             setView]             = useState<'calendar' | 'list' | 'wheel'>('calendar')
  const [deleting,         setDeleting]         = useState<string | null>(null)
  const [selected,         setSelected]         = useState<SelectedLesson | null>(null)
  const [dayDetail,        setDayDetail]        = useState<DayDetail | null>(null)
  const [mobileView,       setMobileView]       = useState<ViewId>('timeGridWorkWeek')
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false)
  const [showFilters,      setShowFilters]      = useState(false)
  const [cohortFilter,     setCohortFilter]     = useState<Record<string,boolean>>({})
  const [teacherFilter,    setTeacherFilter]    = useState<Record<string,boolean>>({})
  const [addEventModal,    setAddEventModal]    = useState<{ date: string; start: string; end: string; allDay: boolean } | null>(null)
  const [addEventMode,     setAddEventMode]     = useState<'choose' | 'personal'>('choose')
  const [newEventTitle,    setNewEventTitle]    = useState('')
  const [newEventLocation, setNewEventLocation] = useState('')
  const [newEventNotes,    setNewEventNotes]    = useState('')
  const [newEventInvitees, setNewEventInvitees] = useState<Record<string, string[]>>({})
  const [inviteeSearch,    setInviteeSearch]    = useState('')
  const [savingPersonal,   setSavingPersonal]   = useState(false)
  const [editingEvent,     setEditingEvent]     = useState<PersonalEventDoc | null>(null)
  const [editTitle,        setEditTitle]        = useState('')
  const [editLocation,     setEditLocation]     = useState('')
  const [editNotes,        setEditNotes]        = useState('')
  const [editDate,         setEditDate]         = useState('')
  const [editStart,        setEditStart]        = useState('')
  const [editEnd,          setEditEnd]          = useState('')
  const [savingEdit,       setSavingEdit]       = useState(false)
  const [editInviteeIds,   setEditInviteeIds]   = useState<string[]>([])
  const [editInviteeSearch, setEditInviteeSearch] = useState('')
  const [viewingInvitedEvent, setViewingInvitedEvent] = useState<PersonalEventDoc | null>(null)
  const calendarRef = useRef<FullCalendar>(null)

  useEffect(() => {
    if (profile?.uid) markCalendarInvitesSeen(profile.uid)
  }, [profile?.uid])

  const { data: rawLessons, loading } = useCollection<LessonDoc>(
    'lessons',
    profile ? [where('teacherIds', 'array-contains', profile.uid)] : [],
    !!profile,
  )
  const lessons = useMemo(
    () => [...rawLessons].sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0)),
    [rawLessons],
  )

  const { data: subjects  } = useCollection<SubjectDoc>('subjects')
  const { data: cohorts   } = useCollection<CohortDoc>('cohorts')
  const { data: blocks      } = useCollection<LessonBlockDoc>('lessonBlocks', [orderBy('order', 'asc')])
  const { data: schoolDay   } = useDocument<SchoolDayDoc>('settings', 'schoolDay')
  const { data: semesterDoc } = useDocument<SemesterSettingsDoc>('settings', 'semester')
  const { data: categories  } = useCollection<LessonCategoryDoc>('lessonCategories', [orderBy('order', 'asc')])

  // Other teachers for filter panel — include anyone with teacher in their roles array
  const { data: allTeacherUsers } = useCollection<UserDoc>(
    'users',
    [where('roles', 'array-contains', 'teacher')],
  )
  const { data: guestTeachers } = useCollection<GuestTeacherDoc>('guest_teachers')

  // My personal events
  const { data: myPersonalEvents } = useCollection<PersonalEventDoc>(
    'personal_events',
    profile ? [where('userId', '==', profile.uid)] : [],
    !!profile,
  )

  // Other teachers' personal events
  const { data: otherTeachersEvents } = useCollection<PersonalEventDoc>(
    'personal_events',
    [where('role', '==', 'teacher')],
  )

  // Events I've been invited to
  const { data: invitedPersonalEvents } = useCollection<PersonalEventDoc>(
    'personal_events',
    profile ? [where('inviteeIds', 'array-contains', profile.uid)] : [],
    !!profile,
  )

  // Office 365 synced events — teachers see all cohorts
  const { data: syncedEvents } = useCollection<SyncedEventDoc>('synced_events', [])

  // All users for invitee picker
  const { data: allUsers } = useCollection<UserDoc>('users')
  const invitableGroups = useMemo(() => {
    type Group = { repId: string; allIds: string[]; displayName: string; roles: string[] }
    const groups: Group[] = []
    const byName = new Map<string, Group>()
    for (const u of allUsers) {
      if (u.id === profile?.uid || u.uid === profile?.uid) continue
      if (u.isActive === false) continue
      const allRoles = u.roles ?? [u.role]
      if (!allRoles.some(r => r === 'student' || r === 'teacher')) continue
      const name = u.displayName?.trim()
      if (!name) continue
      const key = name.toLowerCase()
      const existing = byName.get(key)
      if (existing) {
        if (!existing.allIds.includes(u.id)) existing.allIds.push(u.id)
      } else {
        const g: Group = { repId: u.id, allIds: [u.id], displayName: name, roles: allRoles }
        groups.push(g)
        byName.set(key, g)
      }
    }
    return groups
  }, [allUsers, profile?.uid])
  const filteredGroups = useMemo(
    () => inviteeSearch.trim()
      ? invitableGroups.filter(g => g.displayName.toLowerCase().includes(inviteeSearch.toLowerCase()))
      : invitableGroups,
    [invitableGroups, inviteeSearch],
  )
  const filteredEditGroups = useMemo(
    () => editInviteeSearch.trim()
      ? invitableGroups.filter(g => g.displayName.toLowerCase().includes(editInviteeSearch.toLowerCase()))
      : invitableGroups,
    [invitableGroups, editInviteeSearch],
  )

  const slotMin    = schoolDay?.startTime ? `${schoolDay.startTime}:00` : '07:00:00'
  const slotMax    = schoolDay?.endTime   ? `${schoolDay.endTime}:00`   : '22:00:00'
  const scrollTime = schoolDay?.startTime ? `${schoolDay.startTime}:00` : '07:00:00'

  const subjectMap = useMemo(() => Object.fromEntries(subjects.map(s => [s.id, s])), [subjects])
  const cohortMap  = useMemo(() => Object.fromEntries(cohorts.map(c => [c.id, c])),  [cohorts])

  const myCalendarColor = (profile as any)?.calendarColor ?? '#86bbd8'

  // Initialize cohort filter — all on by default
  const activeCohortIds = useMemo(() => {
    const active: Record<string, boolean> = {}
    cohorts.forEach(c => { active[c.id] = cohortFilter[c.id] !== false })
    return active
  }, [cohorts, cohortFilter])

  // Real lesson events
  const lessonEvents: EventInput[] = useMemo(() => lessons.map(l => {
    const cohortObj  = cohortMap[l.cohortId]
    const cohortIdx  = cohorts.findIndex(c => c.id === l.cohortId)
    const color      = cohortObj?.color ?? COHORT_FALLBACK_COLORS[cohortIdx % COHORT_FALLBACK_COLORS.length] ?? '#33658a'
    const startDate  = toDate(l.startTime)
    const endDate    = toDate(l.endTime)
    const isMultiDay = startDate && endDate && startDate.toDateString() !== endDate.toDateString()

    const base = {
      id:              l.id,
      title:           l.title,
      backgroundColor: color,
      borderColor:     color,
      extendedProps: {
        isBlock:      false,
        subjectTitle: subjectMap[l.subjectId]?.title,
        className:    cohortObj?.name,
        cohortId:     l.cohortId,
        color,
        start:        startDate,
        end:          endDate,
        classroom:    l.classroom,
        isOnline:     l.isOnline,
      },
    }

    if (isMultiDay && startDate && endDate) {
      const endExclusive = new Date(endDate)
      endExclusive.setDate(endExclusive.getDate() + 1)
      return {
        ...base,
        start:  startDate.toISOString().slice(0, 10),
        end:    endExclusive.toISOString().slice(0, 10),
        allDay: true,
      }
    }

    return { ...base, start: startDate ?? undefined, end: endDate ?? undefined }
  }), [lessons, cohortMap, cohorts, subjectMap])

  // Ghost block events — generate for 3 months back + 6 months ahead
  const ghostEvents: EventInput[] = useMemo(() => {
    if (blocks.length === 0) return []
    const result: EventInput[] = []
    const from = new Date(); from.setMonth(from.getMonth() - 3); from.setHours(0, 0, 0, 0)
    const to   = new Date(); to.setMonth(to.getMonth() + 6);   to.setHours(0, 0, 0, 0)
    const cur  = new Date(from)
    while (cur <= to) {
      const dow     = cur.getDay()
      const dateStr = localDateStr(cur)
      for (const block of blocks) {
        const allowed = !block.daysOfWeek?.length || block.daysOfWeek.includes(dow)
        if (!allowed) { continue }
        result.push({
          id:              `ghost-${block.id}-${dateStr}`,
          title:           block.name,
          start:           `${dateStr}T${block.startTime}:00`,
          end:             `${dateStr}T${block.endTime}:00`,
          backgroundColor: 'transparent',
          borderColor:     'transparent',
          textColor:       '#b45309',
          classNames:      ['fc-block-ghost'],
          editable:        false,
          extendedProps: {
            isBlock:    true,
            blockDate:  dateStr,
            blockStart: block.startTime,
            blockEnd:   block.endTime,
            blockName:  block.name,
          },
        })
      }
      cur.setDate(cur.getDate() + 1)
    }
    return result
  }, [blocks])

  // Semester marker events — per-cohort if custom dates exist, else global
  const semesterEvents: EventInput[] = useMemo(() => {
    const out: EventInput[] = []
    const cohortsWithCustom = new Set<string>()

    for (const c of cohorts) {
      if (c.semesterStartDate || c.semesterEndDate) {
        cohortsWithCustom.add(c.id)
        out.push(...semesterMarkers({
          sem1Start: c.semesterStartDate,
          sem1End:   c.semesterEndDate,
          sem2Start: c.semesterSem2StartDate,
          sem2End:   c.semesterSem2EndDate,
        }, c.name))
      }
    }

    // Fall back to global settings for cohorts without custom dates (or show globally if no cohorts)
    if (semesterDoc && (cohortsWithCustom.size < cohorts.length || cohorts.length === 0)) {
      out.push(...semesterMarkers({
        sem1Start: semesterDoc.startDate,
        sem1End:   semesterDoc.endDate,
        sem2Start: semesterDoc.sem2Start,
        sem2End:   semesterDoc.sem2End,
      }))
    }
    return out
  }, [cohorts, semesterDoc])

  // Personal events as FullCalendar EventInput[]
  const personalEventInputs: EventInput[] = useMemo(() => {
    const myColor = (profile as any)?.calendarColor ?? '#86bbd8'
    const mine: EventInput[] = myPersonalEvents.map(e => ({
      id:    `personal-${e.id}`,
      title: e.title,
      start: toDate(e.startTime) ?? undefined,
      end:   e.endTime ? toDate(e.endTime) ?? undefined : undefined,
      allDay: e.allDay,
      backgroundColor: myColor,
      borderColor:     myColor,
      extendedProps: { isPersonal: true, isOwn: true, userId: e.userId, docId: e.id },
    }))

    const others: EventInput[] = otherTeachersEvents
      .filter(e => e.userId !== profile?.uid && teacherFilter[e.userId] !== false)
      .map(e => {
        const teacher = allTeacherUsers.find(t => t.uid === e.userId)
        const color   = (teacher as any)?.calendarColor ?? '#5a7a8e'
        return {
          id:    `personal-${e.id}`,
          title: `${teacher?.displayName ?? 'Teacher'}: ${e.title}`,
          start: toDate(e.startTime) ?? undefined,
          end:   e.endTime ? toDate(e.endTime) ?? undefined : undefined,
          allDay: e.allDay,
          backgroundColor: color,
          borderColor:     color,
          extendedProps: { isPersonal: true, isOwn: false, userId: e.userId },
        }
      })

    return [...mine, ...others]
  }, [myPersonalEvents, otherTeachersEvents, profile, teacherFilter, allTeacherUsers])

  const invitedEventInputs: EventInput[] = useMemo(() => {
    return invitedPersonalEvents.map(e => ({
      id:    `personal-invited-${e.id}`,
      title: `${e.organizerName ?? 'Someone'}: ${e.title}`,
      start: toDate(e.startTime) ?? undefined,
      end:   e.endTime ? toDate(e.endTime) ?? undefined : undefined,
      allDay: e.allDay,
      backgroundColor: '#64748b',
      borderColor:     '#475569',
      extendedProps: { isPersonal: true, isInvited: true, docId: e.id },
    }))
  }, [invitedPersonalEvents])

  const syncedEventInputs: EventInput[] = useMemo(() => {
    return syncedEvents.map(e => {
      const cohortObj = cohortMap[e.cohortId]
      const cohortIdx = cohorts.findIndex(c => c.id === e.cohortId)
      const color = cohortObj?.color ?? (cohortIdx >= 0 ? COHORT_FALLBACK_COLORS[cohortIdx % COHORT_FALLBACK_COLORS.length] : '#0078d4')
      return {
        id:    `synced-${e.id}`,
        title: `📅 ${e.title}`,
        start: toDate(e.startTime) ?? undefined,
        end:   e.endTime ? toDate(e.endTime) ?? undefined : undefined,
        allDay: e.allDay,
        backgroundColor: color,
        borderColor:     color,
        extendedProps: { isSynced: true, location: e.location, cohortId: e.cohortId },
      }
    })
  }, [syncedEvents, cohortMap, cohorts])

  // Filtered lesson events (by cohort toggle)
  const filteredLessonEvents = useMemo(
    () => lessonEvents.filter(e => activeCohortIds[e.extendedProps?.cohortId] !== false),
    [lessonEvents, activeCohortIds],
  )

  const allEvents = useMemo(
    () => [...(showGhostBlocks ? ghostEvents : []), ...filteredLessonEvents, ...semesterEvents, ...personalEventInputs, ...invitedEventInputs, ...syncedEventInputs],
    [showGhostBlocks, ghostEvents, filteredLessonEvents, semesterEvents, personalEventInputs, invitedEventInputs, syncedEventInputs],
  )

  const dayDetailLessons = useMemo(() => {
    if (!dayDetail) return []
    return lessons
      .filter(l => { const s = toDate(l.startTime); return s ? localDateStr(s) === dayDetail.dateStr : false })
      .sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0))
  }, [dayDetail, lessons])

  const dayDetailBlocks = useMemo(() => {
    if (!dayDetail) return []
    const dow = dayDetail.date.getDay()
    return [...blocks]
      .filter(b => !b.daysOfWeek?.length || b.daysOfWeek.includes(dow))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [dayDetail, blocks])

  function snapToBlock(start: Date, end: Date): { start: Date; end: Date } {
    const SNAP_MS = 15 * 60 * 1000
    for (const block of blocks) {
      const [bh, bm] = block.startTime.split(':').map(Number)
      const blockStart = new Date(start)
      blockStart.setHours(bh, bm, 0, 0)
      if (Math.abs(start.getTime() - blockStart.getTime()) <= SNAP_MS) {
        const [eh, em] = block.endTime.split(':').map(Number)
        const blockEnd = new Date(start)
        blockEnd.setHours(eh, em, 0, 0)
        return { start: blockStart, end: blockEnd }
      }
    }
    return { start, end }
  }

  async function handleDrop(lessonId: string, rawStart: Date, rawEnd: Date, eventApi?: { setDates: (s: Date, e: Date) => void }) {
    const { start: newStart, end: newEnd } = snapToBlock(rawStart, rawEnd)
    if (eventApi && (newStart.getTime() !== rawStart.getTime())) {
      eventApi.setDates(newStart, newEnd)
    }
    await updateDoc(doc(db, 'lessons', lessonId), {
      startTime: Timestamp.fromDate(newStart),
      endTime:   Timestamp.fromDate(newEnd),
    })
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this lesson?')) return
    setDeleting(id)
    setSelected(null)
    await deleteDoc(doc(db, 'lessons', id))
    setDeleting(null)
  }

  function openEditEvent(event: PersonalEventDoc) {
    const startDate = event.startTime?.toDate?.()
    const endDate   = event.endTime?.toDate?.()
    setEditingEvent(event)
    setEditTitle(event.title)
    setEditLocation(event.location ?? '')
    setEditNotes(event.notes ?? '')
    setEditDate(startDate ? startDate.toISOString().slice(0, 10) : '')
    setEditStart(startDate && !event.allDay ? startDate.toISOString().slice(11, 16) : '')
    setEditEnd(endDate && !event.allDay ? endDate.toISOString().slice(11, 16) : '')
    setEditInviteeIds(event.inviteeIds ?? [])
  }

  function closeEditEvent() {
    setEditingEvent(null)
    setEditTitle(''); setEditLocation(''); setEditNotes('')
    setEditDate(''); setEditStart(''); setEditEnd('')
    setEditInviteeIds([]); setEditInviteeSearch('')
  }

  function toggleEditInvitee(allIds: string[]) {
    setEditInviteeIds(prev => {
      const hasAny = allIds.some(id => prev.includes(id))
      if (hasAny) return prev.filter(id => !allIds.includes(id))
      return [...prev, ...allIds]
    })
  }

  async function saveEditEvent() {
    if (!editingEvent || !editTitle.trim()) return
    setSavingEdit(true)
    try {
      const startTime = editingEvent.allDay
        ? Timestamp.fromDate(new Date(`${editDate}T00:00:00`))
        : Timestamp.fromDate(new Date(`${editDate}T${editStart}:00`))
      const endTime = editingEvent.allDay ? null : Timestamp.fromDate(new Date(`${editDate}T${editEnd}:00`))
      const newIds = editInviteeIds
      const oldIds = editingEvent.inviteeIds ?? []
      const removedIds = oldIds.filter(id => !newIds.includes(id))
      const addedIds   = newIds.filter(id => !oldIds.includes(id))
      await updateDoc(doc(db, 'personal_events', editingEvent.id), {
        title: editTitle.trim(),
        location: editLocation.trim() || null,
        notes: editNotes.trim() || null,
        startTime, endTime,
        inviteeIds: newIds,
      })
      const fn = httpsCallable(functions, 'sendEventInviteNotifications')
      if (removedIds.length > 0) {
        fn({ inviteeIds: removedIds, organizerName: profile?.displayName, title: editTitle.trim(), canceled: true })
          .catch(e => console.error('cancel notify failed', e))
      }
      if (addedIds.length > 0) {
        fn({ inviteeIds: addedIds, organizerName: profile?.displayName, title: editTitle.trim(),
          dateStr: editDate, timeStr: editingEvent.allDay ? 'All day' : editStart,
          location: editLocation.trim(),
        }).catch(e => console.error('invite notify failed', e))
      }
      closeEditEvent()
    } finally { setSavingEdit(false) }
  }

  async function deletePersonalEvent() {
    if (!editingEvent || !confirm('Delete this event?')) return
    setSavingEdit(true)
    try {
      const allInvitees = editingEvent.inviteeIds ?? []
      await deleteDoc(doc(db, 'personal_events', editingEvent.id))
      if (allInvitees.length > 0) {
        const fn = httpsCallable(functions, 'sendEventInviteNotifications')
        fn({ inviteeIds: allInvitees, organizerName: profile?.displayName, title: editingEvent.title, canceled: true })
          .catch(e => console.error('cancel notify failed', e))
      }
      closeEditEvent()
    } finally { setSavingEdit(false) }
  }

  function closeAddEventModal() {
    setAddEventModal(null)
    setAddEventMode('choose')
    setNewEventTitle('')
    setNewEventLocation('')
    setNewEventNotes('')
    setNewEventInvitees({})
    setInviteeSearch('')
  }

  function toggleInvitee(repId: string, allIds: string[]) {
    setNewEventInvitees(prev => {
      if (prev[repId]) { const next = { ...prev }; delete next[repId]; return next }
      return { ...prev, [repId]: allIds }
    })
  }

  function openSyncedEventEdit(e: SyncedEventDoc) {
    setEditingSyncedEvent(e)
    setSyncedEditLocation(e.customLocation ?? e.location ?? '')
    setSyncedEditNotes(e.notes ?? '')
    setSyncedEditTeachers(e.teacherIds ?? [])
    setSyncedEditGuestTeachers(e.guestTeacherIds ?? [])
  }

  async function saveSyncedEventEdit() {
    if (!editingSyncedEvent) return
    setSavingSyncedEdit(true)
    try {
      await updateDoc(doc(db, 'synced_events', editingSyncedEvent.id), {
        customLocation:  syncedEditLocation.trim() || null,
        notes:           syncedEditNotes.trim() || null,
        teacherIds:      syncedEditTeachers,
        guestTeacherIds: syncedEditGuestTeachers,
      })
      setEditingSyncedEvent(null)
    } finally {
      setSavingSyncedEdit(false)
    }
  }

  async function savePersonalEvent() {
    if (!profile || !newEventTitle.trim() || !addEventModal) return
    setSavingPersonal(true)
    try {
      const { date, start, end, allDay } = addEventModal
      const startTime = allDay
        ? Timestamp.fromDate(new Date(`${date}T00:00:00`))
        : Timestamp.fromDate(new Date(`${date}T${start}:00`))
      const endTime = allDay ? null : Timestamp.fromDate(new Date(`${date}T${end}:00`))
      const title    = newEventTitle.trim()
      const location = newEventLocation.trim()
      const invitees = Object.values(newEventInvitees).flat()
      await addDoc(collection(db, 'personal_events'), {
        userId:        profile.uid,
        organizerName: profile.displayName,
        role:          'teacher',
        title,
        startTime,
        endTime,
        allDay,
        location:      location || null,
        notes:         newEventNotes.trim() || null,
        inviteeIds:    invitees,
        createdAt:     serverTimestamp(),
      })
      closeAddEventModal()
      if (invitees.length > 0) {
        const fn = httpsCallable(functions, 'sendEventInviteNotifications')
        fn({
          inviteeIds:    invitees,
          organizerName: profile.displayName,
          title,
          dateStr:  allDay ? date : `${date}`,
          timeStr:  allDay ? 'All day' : start,
          location,
        }).catch(e => console.error('invite notify failed', e))
      }
    } finally {
      setSavingPersonal(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="page-title">Calendar</h1>
          <p className="text-zinc-500 text-sm mt-1">Schedule and manage your lessons.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/10 overflow-hidden">
            <button
              onClick={() => setView('calendar')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${view === 'calendar' ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:bg-white/5'}`}
            >
              <CalendarDays className="w-4 h-4" /> <span className="hidden sm:inline">Calendar</span>
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-l border-white/10 ${view === 'list' ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:bg-white/5'}`}
            >
              <List className="w-4 h-4" /> <span className="hidden sm:inline">List</span>
            </button>
            {semesterDoc?.startDate && (
              <button
                onClick={() => setView('wheel')}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-l border-white/10 ${view === 'wheel' ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:bg-white/5'}`}
              >
                <Circle className="w-4 h-4" /> <span className="hidden sm:inline">Annual Plan</span>
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`btn-secondary py-2 ${showFilters ? 'bg-brand-500/15 border-brand-500/30 text-brand-400' : ''}`}
          >
            <SlidersHorizontal className="w-4 h-4" /> <span className="hidden sm:inline">Filters</span>
          </button>
          <Link to="/teacher/lessons/new" className="btn-primary py-2">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Lesson</span>
          </Link>
        </div>
      </div>

      {/* ── Filters panel ────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-brand-400" /> Calendar Filters
          </h3>

          {/* Classes */}
          {cohorts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Classes</p>
              <div className="flex flex-wrap gap-2">
                {cohorts.map(c => {
                  const isOn = cohortFilter[c.id] !== false
                  const cohortIdx = cohorts.findIndex(cc => cc.id === c.id)
                  const color = c.color ?? COHORT_FALLBACK_COLORS[cohortIdx % COHORT_FALLBACK_COLORS.length]
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCohortFilter(prev => ({ ...prev, [c.id]: !isOn }))}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border"
                      style={isOn
                        ? { backgroundColor: color + '22', borderColor: color + '66', color }
                        : { background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: '#5a7a8e' }
                      }
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isOn ? color : '#5a7a8e' }} />
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Other teachers */}
          {allTeacherUsers.filter(t => t.uid !== profile?.uid).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Other Teachers' Calendars</p>
              <div className="flex flex-wrap gap-2">
                {allTeacherUsers.filter(t => t.uid !== profile?.uid).map(t => {
                  const isOn  = teacherFilter[t.uid] !== false
                  const color = (t as any).calendarColor ?? '#5a7a8e'
                  return (
                    <button
                      key={t.uid}
                      onClick={() => setTeacherFilter(prev => ({ ...prev, [t.uid]: !isOn }))}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border"
                      style={isOn
                        ? { backgroundColor: color + '22', borderColor: color + '66', color }
                        : { background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: '#5a7a8e' }
                      }
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isOn ? color : '#5a7a8e' }} />
                      {t.displayName}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* My calendar color */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">My Calendar Colour</p>
            <div className="flex flex-wrap gap-2">
              {['#f26419','#f6ae2d','#10b981','#33658a','#86bbd8','#8b5cf6','#f43f5e','#0ea5e9','#14b8a6','#e879f9'].map(hex => (
                <button
                  key={hex}
                  onClick={async () => {
                    if (!profile) return
                    await updateDoc(doc(db, 'users', profile.uid), { calendarColor: hex })
                  }}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                  style={{ backgroundColor: hex }}
                  title={hex}
                >
                  {myCalendarColor === hex && (
                    <svg className="w-3.5 h-3.5 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Calendar view ────────────────────────────────────────────────── */}
      {view === 'calendar' && (
        <>
          {/* Legend */}
          <div className="flex items-center gap-3 flex-wrap">
            {cohorts.map((c, idx) => {
              const color = c.color ?? COHORT_FALLBACK_COLORS[idx % COHORT_FALLBACK_COLORS.length]
              return (
                <div key={c.id} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs text-zinc-400">{c.name}</span>
                </div>
              )
            })}
            {myPersonalEvents.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: myCalendarColor }} />
                <span className="text-xs text-zinc-400">My calendar</span>
              </div>
            )}
          </div>

          {/* Mobile view switcher dropdown */}
          <div className="relative sm:hidden flex justify-end">
            <button
              onClick={() => setViewDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all"
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              {MOBILE_VIEWS.find(v => v.id === mobileView)?.label}
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
            {viewDropdownOpen && (
              <div
                className="absolute top-full right-0 mt-1 z-20 rounded-xl shadow-lg overflow-hidden min-w-[140px]"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)' }}
              >
                {MOBILE_VIEWS.map(v => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setMobileView(v.id)
                      calendarRef.current?.getApi().changeView(v.id)
                      setViewDropdownOpen(false)
                    }}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
                    style={{ color: v.id === mobileView ? 'var(--brand)' : 'var(--text-primary)' }}
                  >
                    {v.label}
                    {v.id === mobileView && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden [&_.fc-toolbar]:flex-wrap [&_.fc-toolbar]:gap-y-2 [&_.fc-toolbar]:px-4 [&_.fc-toolbar]:pt-3 [&_.fc-toolbar-title]:text-base [&_.fc-button]:text-xs [&_.fc-button]:px-2 [&_.fc-button]:py-1 sm:[&_.fc-button]:text-sm sm:[&_.fc-button]:px-3 sm:[&_.fc-button]:py-1.5">
          {blocks.length > 0 && (
            <div className="px-4 pt-3 pb-1 flex items-center gap-2 text-xs text-zinc-400">
              <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-amber-400 bg-amber-950/40" />
              Ghost blocks — click to schedule a lesson in that slot
              <button
                onClick={() => setShowGhostBlocks(v => !v)}
                className={`ml-2 px-2 py-0.5 rounded text-xs border transition-colors ${showGhostBlocks ? 'border-amber-400/50 text-amber-400 bg-amber-950/30 hover:bg-amber-950/60' : 'border-zinc-600 text-zinc-500 hover:text-zinc-300'}`}
              >
                {showGhostBlocks ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={typeof window !== 'undefined' && window.innerWidth < 768 ? 'timeGridWorkWeek' : 'timeGridWeek'}
            firstDay={1}
            weekNumbers={true}
            weekNumberContent={(arg) => `W${arg.num}`}
            headerToolbar={
              typeof window !== 'undefined' && window.innerWidth < 768
                ? { left: 'prev,next', center: 'title', right: '' }
                : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridWorkWeek,timeGridDay' }
            }
            views={{
              timeGridWorkWeek: {
                type:       'timeGrid',
                duration:   { weeks: 1 },
                hiddenDays: [0, 6],
                buttonText: 'work week',
              },
            }}
            events={allEvents}
            height={typeof window !== 'undefined' && window.innerWidth < 768 ? 'calc(100vh - 130px)' : 'calc(100vh - 180px)'}
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            scrollTime={scrollTime}
            allDaySlot={true}
            allDayText="ALL DAY"
            nowIndicator={true}
            dayHeaderFormat={{ weekday: 'short', day: 'numeric' }}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            editable={true}
            selectable={true}
            selectMirror={true}
            eventDrop={(info) => {
              if (info.event.extendedProps.isSemesterMarker) { info.revert(); return }
              if (info.event.extendedProps.isBlock) { info.revert(); return }
              if (!info.event.start) { info.revert(); return }
              const duration = (info.event.end?.getTime() ?? 0) - info.event.start.getTime()
              const rawStart = info.event.start
              const rawEnd   = new Date(rawStart.getTime() + duration)
              setSelected(null)
              handleDrop(info.event.id, rawStart, rawEnd, info.event as any)
            }}
            eventResize={(info) => {
              if (!info.event.start || !info.event.end) { info.revert(); return }
              setSelected(null)
              handleDrop(info.event.id, info.event.start, info.event.end)
            }}
            select={(info) => {
              // drag-to-create: use the dragged range
              if (info.allDay) {
                setAddEventModal({ date: info.startStr, start: schoolDay?.startTime ?? '07:00', end: schoolDay?.endTime ?? '22:00', allDay: true })
                return
              }
              const date  = info.startStr.slice(0, 10)
              const start = info.startStr.slice(11, 16)
              const end   = info.endStr.slice(11, 16)
              setAddEventMode('choose')
              setAddEventModal({ date, start, end, allDay: false })
            }}
            dateClick={(info) => {
              if (info.view.type === 'dayGridMonth') {
                setDayDetail({ date: info.date, dateStr: localDateStr(info.date) })
                return
              }
              // single tap on a time slot — open add-event modal
              const date  = info.dateStr.slice(0, 10)
              const start = info.dateStr.includes('T') ? info.dateStr.slice(11, 16) : (schoolDay?.startTime ?? '08:00')
              const d     = new Date(info.date)
              d.setHours(d.getHours() + 1)
              const end   = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
              setAddEventMode('choose')
              setAddEventModal({ date, start, end, allDay: info.allDay })
            }}
            eventClick={(info) => {
              if (info.event.extendedProps.isSemesterMarker) return
              if (info.event.extendedProps.isSynced) {
                const docId = info.event.id.replace(/^synced-/, '')
                const ev = syncedEvents.find(e => e.id === docId)
                if (ev) openSyncedEventEdit(ev)
                return
              }
              if (info.event.extendedProps.isPersonal) {
                const docId: string = info.event.extendedProps.docId
                if (info.event.extendedProps.isInvited) {
                  setViewingInvitedEvent(invitedPersonalEvents.find(e => e.id === docId) ?? null)
                } else if (info.event.extendedProps.isOwn) {
                  const ev = myPersonalEvents.find(e => e.id === docId)
                  if (ev) openEditEvent(ev)
                }
                return
              }
              const { isBlock, blockDate, blockStart, blockEnd } = info.event.extendedProps
              if (isBlock) {
                setAddEventMode('choose')
                setAddEventModal({ date: blockDate, start: blockStart, end: blockEnd, allDay: false })
                return
              }
              setSelected({
                id:           info.event.id,
                title:        info.event.title,
                subjectTitle: info.event.extendedProps.subjectTitle,
                className:    info.event.extendedProps.className,
                cohortId:     info.event.extendedProps.cohortId,
                start:        info.event.extendedProps.start,
                end:          info.event.extendedProps.end,
                color:        info.event.extendedProps.color,
                classroom:    info.event.extendedProps.classroom,
                isOnline:     info.event.extendedProps.isOnline,
              })
            }}
            eventContent={(arg) => {
              if (arg.event.extendedProps.isBlock) {
                return (
                  <div className="px-1 py-0.5 overflow-hidden select-none" title={`Click to schedule in ${arg.event.extendedProps.blockName}`}>
                    <p className="text-xs font-medium truncate opacity-80">{arg.event.title}</p>
                    <p className="text-xs opacity-50 truncate">
                      {arg.event.extendedProps.blockStart}–{arg.event.extendedProps.blockEnd}
                    </p>
                  </div>
                )
              }
              const s = arg.event.start
              const e = arg.event.end
              const fmt = (d: Date) => d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
              if (arg.isMirror && s && e) {
                return (
                  <div className="px-1 py-0.5 overflow-hidden">
                    <p className="text-[11px] font-bold truncate mb-0.5 bg-white/25 rounded px-1 inline-block">{fmt(s)} – {fmt(e)}</p>
                    <p className="text-xs font-semibold truncate">{arg.event.title}</p>
                    {arg.event.extendedProps.className && (
                      <p className="text-xs opacity-80 truncate">{arg.event.extendedProps.className}</p>
                    )}
                  </div>
                )
              }
              return (
                <div className="px-1 py-0.5 h-full overflow-hidden">
                  <p className="text-xs font-semibold leading-tight line-clamp-3">{arg.event.title}</p>
                  {arg.event.extendedProps.className && (
                    <p className="text-xs opacity-80 truncate">{arg.event.extendedProps.className}</p>
                  )}
                  {arg.event.extendedProps.classroom && (
                    <p className="text-xs opacity-70 truncate">
                      {arg.event.extendedProps.isOnline ? '🌐' : '📍'} {arg.event.extendedProps.classroom}
                    </p>
                  )}
                  {arg.event.extendedProps.isSynced && arg.event.extendedProps.location && (
                    <p className="text-xs opacity-70 truncate">📍 {arg.event.extendedProps.location}</p>
                  )}
                </div>
              )
            }}
          />
        </div>
        </>
      )}

      {/* ── Annual plan wheel ────────────────────────────────────────────── */}
      {view === 'wheel' && semesterDoc?.startDate && semesterDoc?.endDate && (
        <div className="card py-8 px-8">
          <AnnualPlanWheel
            lessons={lessons}
            subjects={subjects}
            categories={categories}
            sem1Start={semesterDoc.startDate}
            sem1End={semesterDoc.endDate}
            sem2Start={semesterDoc.sem2Start}
            sem2End={semesterDoc.sem2End}
            syncedEvents={syncedEvents}
            cohorts={cohorts}
          />
        </div>
      )}

      {/* ── List view ────────────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="space-y-6">
          {lessons.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No lessons yet"
              description="Click New Lesson or tap an empty slot in the calendar to get started."
            />
          ) : (
            <div className="space-y-3">
              {lessons.map(lesson => {
                const subj   = subjectMap[lesson.subjectId]
                const cohort = cohortMap[lesson.cohortId]
                return (
                  <div key={lesson.id} className="bg-zinc-900 rounded-2xl border border-white/10 p-4 flex items-center gap-4 shadow-sm">
                    <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${subj?.color ?? 'bg-brand-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-100">{lesson.iconEmoji ? `${lesson.iconEmoji} ` : ''}{lesson.title}</p>
                        {lesson.isOnline && <span className="badge badge-blue">Online</span>}
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {subj ? `${subj.iconEmoji} ${subj.title}` : '—'}
                        {cohort ? ` · ${cohort.name}` : ''}
                        {' · '}
                        {shortDate(lesson.startTime)} {timeStr(lesson.startTime)}–{timeStr(lesson.endTime)}
                        {lesson.classroom ? ` · ${lesson.classroom}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Link
                        to={`/teacher/lessons/${lesson.id}/edit`}
                        className="p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                      <button
                        onClick={() => handleDelete(lesson.id)}
                        disabled={deleting === lesson.id}
                        className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {syncedEvents.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1">📅 Outlook Calendar Events</p>
              {[...syncedEvents]
                .sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0))
                .map(e => {
                  const cohortObj = cohortMap[e.cohortId]
                  const cohortIdx = cohorts.findIndex(c => c.id === e.cohortId)
                  const color = cohortObj?.color ?? (cohortIdx >= 0 ? COHORT_FALLBACK_COLORS[cohortIdx % COHORT_FALLBACK_COLORS.length] : '#0078d4')
                  const location = e.customLocation ?? e.location
                  return (
                    <div key={e.id} className="bg-zinc-900 rounded-2xl border border-white/10 p-4 flex items-center gap-4 shadow-sm">
                      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-zinc-100">{e.title}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {cohortObj?.name ?? e.cohortId}
                          {' · '}
                          {e.allDay
                            ? toDate(e.startTime)?.toLocaleDateString('sv-SE', { weekday: 'short', month: 'short', day: 'numeric' })
                            : `${shortDate(e.startTime)} ${timeStr(e.startTime)}${e.endTime ? `–${timeStr(e.endTime)}` : ''}`
                          }
                          {location ? ` · ${location}` : ''}
                        </p>
                        {e.notes && <p className="text-xs text-zinc-500 mt-0.5 italic">{e.notes}</p>}
                      </div>
                      <button
                        onClick={() => openSyncedEventEdit(e)}
                        className="p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {/* ── Synced event edit modal ──────────────────────────────────────── */}
      {editingSyncedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingSyncedEvent(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-base font-bold text-zinc-100">{editingSyncedEvent.title}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  📅 Outlook · {cohortMap[editingSyncedEvent.cohortId]?.name ?? editingSyncedEvent.cohortId}
                </p>
              </div>
              <button onClick={() => setEditingSyncedEvent(null)} className="text-zinc-400 hover:text-zinc-200 p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Location override</label>
                <input
                  value={syncedEditLocation}
                  onChange={e => setSyncedEditLocation(e.target.value)}
                  placeholder={editingSyncedEvent.location ?? 'Add location…'}
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Assign teachers</label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {syncedEditTeachers.map(tid => {
                    const t = allTeacherUsers.find(u => u.uid === tid || u.id === tid)
                    return (
                      <span key={tid} className="flex items-center gap-1 bg-zinc-700 text-xs text-zinc-200 px-2 py-0.5 rounded-full">
                        {t?.displayName ?? tid}
                        <button onClick={() => setSyncedEditTeachers(prev => prev.filter(id => id !== tid))} className="text-zinc-400 hover:text-zinc-200"><X className="w-3 h-3" /></button>
                      </span>
                    )
                  })}
                </div>
                <select
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500"
                  value=""
                  onChange={e => { if (e.target.value && !syncedEditTeachers.includes(e.target.value)) setSyncedEditTeachers(prev => [...prev, e.target.value]) }}
                >
                  <option value="">+ Add teacher…</option>
                  {allTeacherUsers.filter(t => !syncedEditTeachers.includes(t.uid ?? t.id)).map(t => (
                    <option key={t.uid ?? t.id} value={t.uid ?? t.id}>{t.displayName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Assign guest teachers</label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {syncedEditGuestTeachers.map(gid => {
                    const g = guestTeachers.find(gt => gt.id === gid)
                    return (
                      <span key={gid} className="flex items-center gap-1 bg-zinc-700 text-xs text-zinc-200 px-2 py-0.5 rounded-full">
                        {g?.name ?? gid}
                        <button onClick={() => setSyncedEditGuestTeachers(prev => prev.filter(id => id !== gid))} className="text-zinc-400 hover:text-zinc-200"><X className="w-3 h-3" /></button>
                      </span>
                    )
                  })}
                </div>
                <select
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500"
                  value=""
                  onChange={e => { if (e.target.value && !syncedEditGuestTeachers.includes(e.target.value)) setSyncedEditGuestTeachers(prev => [...prev, e.target.value]) }}
                >
                  <option value="">+ Add guest teacher…</option>
                  {[...guestTeachers].sort((a,b) => a.name.localeCompare(b.name)).filter(g => !syncedEditGuestTeachers.includes(g.id)).map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Notes</label>
                <textarea
                  value={syncedEditNotes}
                  onChange={e => setSyncedEditNotes(e.target.value)}
                  placeholder="Internal notes…"
                  rows={2}
                  className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 resize-none"
                />
              </div>
            </div>
            <button
              onClick={saveSyncedEventEdit}
              disabled={savingSyncedEdit}
              className="w-full btn-primary text-sm py-2"
            >
              {savingSyncedEdit ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* ── Lesson detail modal ──────────────────────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div
              className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
              style={{ backgroundColor: selected.color }}
            />
            <div className="flex items-start justify-between pt-1">
              <div>
                <p className="text-base font-bold text-zinc-100">{selected.title}</p>
                {selected.subjectTitle && (
                  <p className="text-xs text-zinc-500 mt-0.5">{selected.subjectTitle}</p>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm text-zinc-400 space-y-1">
              {selected.className && (
                <p><span className="font-medium">Class:</span> {selected.className}</p>
              )}
              {selected.start && selected.end && (
                <p>
                  <span className="font-medium">Time:</span>{' '}
                  {selected.start.toLocaleDateString('sv-SE', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {' '}
                  {selected.start.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                  {' – '}
                  {selected.end.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              {selected.classroom && (
                <p>
                  <span className="font-medium">{selected.isOnline ? 'Link:' : 'Room:'}</span>{' '}
                  {selected.isOnline
                    ? <a href={selected.classroom} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{selected.classroom}</a>
                    : selected.classroom
                  }
                </p>
              )}
            </div>
            <LessonAttendance lessonId={selected.id} cohortId={selected.cohortId} />

            <button
              onClick={() => {
                startAttendance(selected.id, selected.title)
                setSelected(null)
              }}
              className="w-full btn-primary py-2.5 text-sm"
            >
              <QrCode className="w-4 h-4" /> Start Attendance
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => { navigate(`/teacher/lessons/${selected.id}/edit`); setSelected(null) }}
                className="flex-1 btn-secondary py-2 text-sm"
              >
                <Pencil className="w-4 h-4" /> Edit
              </button>
              <button
                onClick={() => handleDelete(selected.id)}
                disabled={deleting === selected.id}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm font-medium transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" /> {deleting === selected.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Day detail modal (month view) ────────────────────────────────── */}
      {dayDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDayDetail(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-bold text-zinc-100">
                  {dayDetail.date.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {dayDetailLessons.length} lesson{dayDetailLessons.length !== 1 ? 's' : ''} scheduled
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { navigate(`/teacher/lessons/new?date=${dayDetail.dateStr}&start=${schoolDay?.startTime ?? '07:00'}&end=${schoolDay?.endTime ?? '22:00'}`); setDayDetail(null) }}
                  className="btn-primary py-1.5 px-3 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" /> New lesson
                </button>
                <button onClick={() => setDayDetail(null)} className="p-1.5 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto space-y-2 flex-1">
              {/* Blocks for this weekday */}
              {dayDetailBlocks.map(b => {
                const hasLesson = dayDetailLessons.some(l => {
                  const ls = toDate(l.startTime)?.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
                  return ls === b.startTime
                })
                return (
                  <div key={b.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl border border-dashed border-amber-300 ${hasLesson ? 'bg-amber-950/30' : 'bg-amber-950/20'}`}>
                    <div className="w-16 text-xs text-amber-600 font-medium shrink-0">{b.startTime}–{b.endTime}</div>
                    <div className="flex-1">
                      <p className="text-xs text-amber-700 font-medium">{b.name}</p>
                      {hasLesson && <p className="text-[10px] text-amber-500">lesson scheduled</p>}
                    </div>
                    {!hasLesson && (
                      <button
                        onClick={() => { navigate(`/teacher/lessons/new?date=${dayDetail.dateStr}&start=${b.startTime}&end=${b.endTime}`); setDayDetail(null) }}
                        className="text-[10px] text-amber-600 hover:text-amber-800 border border-amber-300 rounded-md px-2 py-0.5 hover:bg-amber-100 transition-colors shrink-0"
                      >
                        + Schedule
                      </button>
                    )}
                  </div>
                )
              })}

              {/* Lessons for this day */}
              {dayDetailLessons.length === 0 && dayDetailBlocks.length === 0 && (
                <p className="text-sm text-zinc-400 text-center py-4">No lessons or blocks for this day.</p>
              )}
              {dayDetailLessons.map(lesson => {
                const cohortObj = cohortMap[lesson.cohortId]
                const cIdx = cohorts.findIndex(c => c.id === lesson.cohortId)
                const color = cohortObj?.color ?? COHORT_FALLBACK_COLORS[cIdx % COHORT_FALLBACK_COLORS.length] ?? '#33658a'
                return (
                  <div key={lesson.id} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-white/8 bg-zinc-900 shadow-sm">
                    <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <div className="w-16 text-xs text-zinc-500 shrink-0">
                      {toDate(lesson.startTime)?.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-200 truncate">{lesson.iconEmoji ? `${lesson.iconEmoji} ` : ''}{lesson.title}</p>
                      <p className="text-xs text-zinc-400 truncate">
                        {subjectMap[lesson.subjectId]?.title}{lesson.classroom ? ` · ${lesson.isOnline ? '🌐' : '📍'} ${lesson.classroom}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => { navigate(`/teacher/lessons/${lesson.id}/edit`); setDayDetail(null) }}
                      className="p-1.5 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Add event modal ──────────────────────────────────────────────── */}
      {addEventModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={closeAddEventModal}>
          <div className="relative rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {addEventMode === 'personal' ? 'Personal Event' : 'Add to Calendar'}
              </p>
              <button onClick={closeAddEventModal} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {addEventMode === 'choose' ? (
              /* Step 1 — choose type */
              <div className="p-4 space-y-2">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all border"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  onClick={() => {
                    navigate(`/teacher/lessons/new?date=${addEventModal!.date}&start=${addEventModal!.start}&end=${addEventModal!.end}`)
                    closeAddEventModal()
                  }}
                >
                  <CalendarDays className="w-5 h-5 text-brand-400 flex-shrink-0" />
                  <div className="text-left">
                    <p className="font-semibold">New Lesson</p>
                    <p className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>Assign class, subject, room…</p>
                  </div>
                </button>
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all border"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  onClick={() => setAddEventMode('personal')}
                >
                  <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: myCalendarColor }}>
                    <span className="text-[10px] text-white font-bold">P</span>
                  </div>
                  <div className="text-left">
                    <p className="font-semibold">Personal Event</p>
                    <p className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>Visible to other teachers</p>
                  </div>
                </button>
              </div>
            ) : (
              /* Step 2 — personal event form */
              <div className="p-4 space-y-3 overflow-y-auto">
                <input
                  autoFocus
                  value={newEventTitle}
                  onChange={e => setNewEventTitle(e.target.value)}
                  className="input text-sm"
                  placeholder="Title *"
                />
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-3">
                    <label className="label text-xs">Date</label>
                    <input
                      type="date"
                      value={addEventModal.date}
                      onChange={e => setAddEventModal(prev => prev ? { ...prev, date: e.target.value } : null)}
                      className="input text-sm"
                    />
                  </div>
                  {!addEventModal.allDay && (
                    <>
                      <div className="col-span-3 grid grid-cols-2 gap-2">
                        <div>
                          <label className="label text-xs">Start</label>
                          <input
                            type="time"
                            value={addEventModal.start}
                            onChange={e => setAddEventModal(prev => prev ? { ...prev, start: e.target.value } : null)}
                            className="input text-sm"
                          />
                        </div>
                        <div>
                          <label className="label text-xs">End</label>
                          <input
                            type="time"
                            value={addEventModal.end}
                            onChange={e => setAddEventModal(prev => prev ? { ...prev, end: e.target.value } : null)}
                            className="input text-sm"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <input
                  value={newEventLocation}
                  onChange={e => setNewEventLocation(e.target.value)}
                  className="input text-sm"
                  placeholder="Location (optional)"
                />
                <textarea
                  rows={2}
                  value={newEventNotes}
                  onChange={e => setNewEventNotes(e.target.value)}
                  className="input text-sm resize-none"
                  placeholder="Notes (optional)"
                />

                {/* Invite people */}
                <div>
                  <label className="label text-xs flex items-center justify-between">
                    <span>Invite people</span>
                    {Object.keys(newEventInvitees).length > 0 && (
                      <span className="text-brand-500 font-normal">{Object.keys(newEventInvitees).length} invited</span>
                    )}
                  </label>
                  <input
                    value={inviteeSearch}
                    onChange={e => setInviteeSearch(e.target.value)}
                    className="input text-sm mb-1.5"
                    placeholder="Search by name…"
                  />
                  <div className="max-h-36 overflow-y-auto rounded-xl border space-y-0.5 p-1" style={{ borderColor: 'var(--border)' }}>
                    {filteredGroups.length === 0 ? (
                      <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>No users found</p>
                    ) : filteredGroups.map(g => {
                      const selected = !!newEventInvitees[g.repId]
                      const roleLabel = g.roles.includes('teacher') ? 'teacher' : 'student'
                      return (
                        <button
                          key={g.repId}
                          type="button"
                          onClick={() => toggleInvitee(g.repId, g.allIds)}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left ${selected ? 'bg-brand-600/20' : 'hover:bg-white/5'}`}
                        >
                          <span className="flex-1" style={{ color: selected ? 'var(--brand)' : 'var(--text-primary)' }}>{g.displayName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${roleLabel === 'teacher' ? 'bg-amber-900/50 text-amber-400' : 'bg-zinc-800 text-zinc-500'}`}>{roleLabel}</span>
                          {selected && <Check className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setAddEventMode('choose')}
                    className="btn-secondary py-2 px-3 text-sm"
                  >
                    ← Back
                  </button>
                  <button
                    disabled={!newEventTitle.trim() || savingPersonal}
                    className="flex-1 btn-primary py-2 text-sm disabled:opacity-50"
                    onClick={savePersonalEvent}
                  >
                    {savingPersonal ? 'Saving…' : Object.keys(newEventInvitees).length > 0 ? `Save & Invite ${Object.keys(newEventInvitees).length}` : 'Add to My Calendar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit personal event modal ─────────────────────────────────────── */}
      {editingEvent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={closeEditEvent}>
          <div className="relative rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Edit Personal Event</p>
              <div className="flex items-center gap-1">
                <button onClick={deletePersonalEvent} disabled={savingEdit} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500 transition-colors disabled:opacity-40">
                  <Trash2 className="w-4 h-4" />
                </button>
                <button onClick={closeEditEvent} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              <input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)} className="input text-sm" placeholder="Title *" />
              <div>
                <label className="label text-xs">Date</label>
                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="input text-sm" />
              </div>
              {!editingEvent.allDay && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-xs">Start</label>
                    <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} className="input text-sm" />
                  </div>
                  <div>
                    <label className="label text-xs">End</label>
                    <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} className="input text-sm" />
                  </div>
                </div>
              )}
              <input value={editLocation} onChange={e => setEditLocation(e.target.value)} className="input text-sm" placeholder="Location (optional)" />
              <textarea rows={2} value={editNotes} onChange={e => setEditNotes(e.target.value)} className="input text-sm resize-none" placeholder="Notes (optional)" />

              {/* Invite / manage people */}
              <div>
                <label className="label text-xs flex items-center justify-between">
                  <span>Invite people</span>
                  {editInviteeIds.length > 0 && (
                    <span className="text-brand-500 font-normal">{invitableGroups.filter(g => g.allIds.some(id => editInviteeIds.includes(id))).length} invited</span>
                  )}
                </label>
                <input
                  value={editInviteeSearch}
                  onChange={e => setEditInviteeSearch(e.target.value)}
                  className="input text-sm mb-1.5"
                  placeholder="Search by name…"
                />
                <div className="max-h-36 overflow-y-auto rounded-xl border space-y-0.5 p-1" style={{ borderColor: 'var(--border)' }}>
                  {filteredEditGroups.length === 0 ? (
                    <p className="text-xs text-center py-3" style={{ color: 'var(--text-muted)' }}>No users found</p>
                  ) : filteredEditGroups.map(g => {
                    const isSelected = g.allIds.some(id => editInviteeIds.includes(id))
                    const roleLabel = g.roles.includes('teacher') ? 'teacher' : 'student'
                    return (
                      <button
                        key={g.repId}
                        type="button"
                        onClick={() => toggleEditInvitee(g.allIds)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left ${isSelected ? 'bg-brand-600/20' : 'hover:bg-white/5'}`}
                      >
                        <span className="flex-1" style={{ color: isSelected ? 'var(--brand)' : 'var(--text-primary)' }}>{g.displayName}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${roleLabel === 'teacher' ? 'bg-amber-900/50 text-amber-400' : 'bg-zinc-800 text-zinc-500'}`}>{roleLabel}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              <button disabled={!editTitle.trim() || savingEdit} className="w-full btn-primary py-2.5 text-sm disabled:opacity-50" onClick={saveEditEvent}>
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invited event detail modal ────────────────────────────────────── */}
      {viewingInvitedEvent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setViewingInvitedEvent(null)}>
          <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Invited Event</span>
              </div>
              <button onClick={() => setViewingInvitedEvent(null)} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <h2 className="text-lg font-bold text-zinc-100">{viewingInvitedEvent.title}</h2>
              {viewingInvitedEvent.organizerName && (
                <p className="text-sm text-zinc-400">Invited by <span className="text-zinc-200 font-medium">{viewingInvitedEvent.organizerName}</span></p>
              )}
              {viewingInvitedEvent.startTime && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <CalendarDays className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {viewingInvitedEvent.allDay
                      ? viewingInvitedEvent.startTime.toDate().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · All day'
                      : viewingInvitedEvent.startTime.toDate().toLocaleString('sv-SE', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        + (viewingInvitedEvent.endTime ? ' – ' + viewingInvitedEvent.endTime.toDate().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '')
                    }
                  </span>
                </div>
              )}
              {viewingInvitedEvent.location && (
                <p className="text-sm text-zinc-400">📍 {viewingInvitedEvent.location}</p>
              )}
              {viewingInvitedEvent.notes && (
                <p className="text-sm text-zinc-500 leading-relaxed">{viewingInvitedEvent.notes}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
