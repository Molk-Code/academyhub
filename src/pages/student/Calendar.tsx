import { useMemo, useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin  from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput } from '@fullcalendar/core'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, where, orderBy } from '@/hooks/useFirestore'
import { toDate } from '@/lib/utils'
import type { LessonDoc, AssignmentDoc, SubjectDoc, SemesterSettingsDoc, LessonCategoryDoc, CohortDoc, PersonalEventDoc, UserDoc, SyncedEventDoc } from '@/types'
import { addDoc, collection, serverTimestamp, Timestamp, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'

function semesterMarkers(dates: {
  sem1Start?: string; sem1End?: string
  sem2Start?: string; sem2End?: string
}): EventInput[] {
  const mk = (id: string, title: string, date: string, color: string): EventInput => ({
    id, title, start: date, allDay: true,
    backgroundColor: color, borderColor: color, textColor: '#fff',
    editable: false,
    extendedProps: { isSemesterMarker: true },
  })
  const out: EventInput[] = []
  if (dates.sem1Start) out.push(mk('sm-s1s', '🎓 Semester 1 — Start', dates.sem1Start, '#10b981'))
  if (dates.sem1End)   out.push(mk('sm-s1e', '🏁 Semester 1 — End',   dates.sem1End,   '#f59e0b'))
  if (dates.sem2Start) out.push(mk('sm-s2s', '🎓 Semester 2 — Start', dates.sem2Start, '#10b981'))
  if (dates.sem2End)   out.push(mk('sm-s2e', '🏁 Semester 2 — End',   dates.sem2End,   '#f59e0b'))
  return out
}
import AnnualPlanWheel from '@/components/calendar/AnnualPlanWheel'
import LessonAttendancePanel from '@/components/calendar/LessonAttendancePanel'
import { Circle, X, CalendarDays, BookOpen, Clock, ChevronDown, Check, MapPin, Trash2 } from 'lucide-react'
import { markCalendarInvitesSeen } from '@/hooks/useCalendarInviteBadge'
import { format } from 'date-fns'

type ViewId = 'timeGridWorkWeek' | 'timeGridWeek' | 'dayGridMonth' | 'timeGridDay'
const MOBILE_VIEWS: { id: ViewId; label: string }[] = [
  { id: 'timeGridWorkWeek', label: 'Work week' },
  { id: 'timeGridWeek',     label: 'Week'      },
  { id: 'dayGridMonth',     label: 'Month'     },
  { id: 'timeGridDay',      label: 'Day'       },
]

interface SchoolDayDoc { id: string; startTime: string; endTime: string }

interface SelectedEvent {
  type: 'lesson' | 'assignment' | 'semesterMarker' | 'synced'
  lessonId?: string
  title: string
  classroom?: string
  isOnline?: boolean
  startTime?: Date
  endTime?: Date
  description?: string
  subjectTitle?: string
  subjectColor?: string
  subjectId?: string
  pointsValue?: number
  dueDate?: Date
  location?: string
  overrideTeachers?: string[]
  overrideNotes?: string
}

export default function StudentCalendar() {
  const [showWheel, setShowWheel] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null)
  const [mobileView, setMobileView] = useState<ViewId>('timeGridWeek')
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false)
  const [addEventModal, setAddEventModal] = useState<{ date: string; start: string; end: string; allDay: boolean } | null>(null)
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventLocation, setNewEventLocation] = useState('')
  const [newEventNotes, setNewEventNotes] = useState('')
  // repId → allIds for that person (stores every doc ID so profile.uid always matches)
  const [newEventInvitees, setNewEventInvitees] = useState<Record<string, string[]>>({})
  const [inviteeSearch, setInviteeSearch] = useState('')
  const [savingPersonal, setSavingPersonal] = useState(false)
  const [editingEvent, setEditingEvent] = useState<PersonalEventDoc | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editInviteeIds, setEditInviteeIds] = useState<string[]>([])
  const [editInviteeSearch, setEditInviteeSearch] = useState('')
  const [viewingInvitedEvent, setViewingInvitedEvent] = useState<PersonalEventDoc | null>(null)
  const calendarRef    = useRef<FullCalendar>(null)
  const calendarCardRef = useRef<HTMLDivElement>(null)

  const [isLandscape, setIsLandscape] = useState(
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight && window.innerHeight < 600 : false
  )
  useEffect(() => {
    const update = () => setIsLandscape(window.innerWidth > window.innerHeight && window.innerHeight < 600)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('orientationchange', update) }
  }, [])
  const isMobileDim = typeof window !== 'undefined' ? Math.min(window.innerWidth, window.innerHeight) < 600 : false

  // Extend the native now-indicator line across ALL day columns (not just today's)
  useEffect(() => {
    const card = calendarCardRef.current
    if (!card) return

    let scheduled = false
    let obs: MutationObserver | null = null
    function sync() {
      scheduled = false
      const card = calendarCardRef.current
      if (!card) return
      obs?.disconnect()
      try {
        card.querySelectorAll('.x-now-ext').forEach(el => el.remove())

        const body = card.querySelector<HTMLElement>('.fc-timegrid-body')
        const todayLine = card.querySelector<HTMLElement>(
          '.fc-timegrid-col.fc-day-today .fc-timegrid-now-indicator-line',
        )
        if (!body || !todayLine) return

        const bodyRect = body.getBoundingClientRect()
        const lineRect = todayLine.getBoundingClientRect()
        const topPx = lineRect.top - bodyRect.top

        // First non-axis day column defines the left edge; last defines the right
        const dayCols = Array.from(card.querySelectorAll<HTMLElement>(
          '.fc-timegrid-col:not(.fc-timegrid-axis)',
        ))
        if (dayCols.length === 0) return
        const firstRect = dayCols[0].getBoundingClientRect()
        const lastRect  = dayCols[dayCols.length - 1].getBoundingClientRect()
        const leftPx  = firstRect.left - bodyRect.left
        const widthPx = lastRect.right - firstRect.left

        const el = document.createElement('div')
        el.className = 'x-now-ext'
        el.style.cssText = `position:absolute;top:${topPx}px;left:${leftPx}px;width:${widthPx}px;height:0;border-top:2px solid #f26419;pointer-events:none;z-index:5;`
        body.appendChild(el)
      } finally {
        obs?.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
      }
    }
    function schedule() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(sync)
    }

    const t1 = setTimeout(sync, 400)
    const t2 = setTimeout(sync, 1200)
    const id = setInterval(sync, 60_000)
    obs = new MutationObserver(schedule)
    obs.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', schedule)
    card.addEventListener('scroll', schedule, true)

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearInterval(id)
      obs?.disconnect()
      window.removeEventListener('resize', schedule)
      card?.removeEventListener('scroll', schedule, true)
      calendarCardRef.current?.querySelectorAll('.x-now-ext').forEach(el => el.remove())
    }
  }, [mobileView])

  const swipeTouchX  = useRef<number | null>(null)
  const swipeTouchY  = useRef<number | null>(null)
  const swipeAxis    = useRef<'h' | 'v' | null>(null)

  function renderEventContent(arg: import('@fullcalendar/core').EventContentArg) {
    const { event, view } = arg
    const isMonth  = view.type === 'dayGridMonth'
    const isAllDay = event.allDay
    // Strip emoji characters from titles (e.g. synced Apple Calendar 📅 icon)
    const title = event.title.replace(/\p{Emoji_Presentation}/gu, '').replace(/\s+/g, ' ').trim()

    if (isMonth || isAllDay) {
      return (
        <div style={{ fontSize: '10px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', padding: '0 2px', lineHeight: '1' }}>
          {title}
        </div>
      )
    }

    const durationMin = event.end && event.start
      ? (event.end.getTime() - event.start.getTime()) / 60000
      : 60

    if (durationMin <= 25) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%', overflow: 'hidden', padding: '0 2px' }}>
          <span style={{ fontSize: '9px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '1' }}>{title}</span>
        </div>
      )
    }

    if (durationMin <= 55) {
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', height: '100%', overflow: 'hidden', padding: '2px 2px 1px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, lineHeight: '1.25', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{title}</span>
        </div>
      )
    }

    if (durationMin <= 100) {
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', height: '100%', overflow: 'hidden', padding: '3px 2px 2px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, lineHeight: '1.3', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>{title}</span>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', height: '100%', overflow: 'hidden', padding: '4px 2px 2px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, lineHeight: '1.35', overflow: 'hidden' }}>{title}</span>
      </div>
    )
  }

  function getViewHarness(): HTMLElement | null {
    return (calendarCardRef.current?.querySelector('.fc-view-harness') as HTMLElement) ?? null
  }

  function slideAndNavigate(direction: 'next' | 'prev') {
    const api = calendarRef.current?.getApi()
    if (!api) return
    const vh = getViewHarness()
    if (!vh) return
    const w      = vh.offsetWidth
    const exitX  = direction === 'next' ? -w : w
    const enterX = direction === 'next' ?  w : -w
    // Animate out from current drag position to full exit
    vh.style.transition = 'transform 160ms ease-in'
    vh.style.transform  = `translateX(${exitX}px)`
    setTimeout(() => {
      direction === 'next' ? api.next() : api.prev()
      const vhNew = getViewHarness()
      if (!vhNew) return
      vhNew.style.transition = 'none'
      vhNew.style.transform  = `translateX(${enterX}px)`
      requestAnimationFrame(() => requestAnimationFrame(() => {
        vhNew.style.transition = 'transform 240ms cubic-bezier(0.25,0.46,0.45,0.94)'
        vhNew.style.transform  = ''
      }))
    }, 160)
  }

  // Imperative touch listeners with passive:false so we can preventDefault and stop iOS scroll
  useEffect(() => {
    const el = calendarCardRef.current
    if (!el) return
    const onStart = (e: TouchEvent) => {
      swipeTouchX.current = e.touches[0].clientX
      swipeTouchY.current = e.touches[0].clientY
      swipeAxis.current   = null
    }
    const onMove = (e: TouchEvent) => {
      if (swipeTouchX.current === null) return
      const dx = e.touches[0].clientX - swipeTouchX.current
      const dy = e.touches[0].clientY - (swipeTouchY.current ?? 0)
      if (!swipeAxis.current) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        swipeAxis.current = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'h' : 'v'
      }
      if (swipeAxis.current !== 'h') return
      // touch-action:pan-y on the container means browser won't scroll horizontally,
      // so no preventDefault needed — horizontal movement goes straight to JS
      const vh = getViewHarness()
      if (vh) { vh.style.transition = 'none'; vh.style.transform = `translateX(${dx * 0.4}px)` }
    }
    const onEnd = (e: TouchEvent) => {
      if (swipeTouchX.current === null) return
      const dx = e.changedTouches[0].clientX - swipeTouchX.current
      swipeTouchX.current = null
      if (swipeAxis.current !== 'h' || Math.abs(dx) < 60) {
        const vh = getViewHarness()
        if (vh) { vh.style.transition = 'transform 200ms ease-out'; vh.style.transform = '' }
        return
      }
      slideAndNavigate(dx < 0 ? 'next' : 'prev')
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove',  onMove,  { passive: false })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove',  onMove)
      el.removeEventListener('touchend',   onEnd)
    }
  }, [])

  const { profile, role, roles, cohortId: ctxCohortId, previewCohortId } = useAuth()
  const isStaff = roles.some(r => r === 'teacher' || r === 'admin') || (role ?? profile?.role) === 'teacher' || (role ?? profile?.role) === 'admin'
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? null
  const { data: schoolDay } = useDocument<SchoolDayDoc>('settings', 'schoolDay')
  const slotMin    = schoolDay?.startTime ? `${schoolDay.startTime}:00` : '07:00:00'
  const slotMax    = schoolDay?.endTime   ? `${schoolDay.endTime}:00`   : '22:00:00'
  const scrollTime = schoolDay?.startTime ? `${schoolDay.startTime}:00` : '07:00:00'

  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )

  const { data: assignments } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )

  const { data: subjects }    = useCollection<SubjectDoc>('subjects', cohortId ? [where('cohortId', '==', cohortId)] : [], !!cohortId)
  const { data: categories }  = useCollection<LessonCategoryDoc>('lessonCategories', [orderBy('order', 'asc')])
  const { data: semesterDoc } = useDocument<SemesterSettingsDoc>('settings', 'semester')
  const { data: cohorts }     = useCollection<CohortDoc>('cohorts')
  const myCohort = useMemo(() => cohorts.find(c => c.id === cohortId) ?? null, [cohorts, cohortId])

  const { data: myPersonalEvents } = useCollection<PersonalEventDoc>(
    'personal_events',
    profile ? [where('userId', '==', profile.uid)] : [],
    !!profile,
  )

  const { data: invitedPersonalEvents } = useCollection<PersonalEventDoc>(
    'personal_events',
    profile ? [where('inviteeIds', 'array-contains', profile.uid)] : [],
    !!profile,
  )

  // Events synced in from an Outlook calendar (Office 365 Calendar Sync, admin settings).
  // Teachers/admins see all synced events; students see only their cohort + "all".
  // Preview mode (previewCohortId set) narrows staff to the previewed cohort so it matches
  // what the student would see.
  const showAllSynced = isStaff && !previewCohortId
  const { data: syncedEvents } = useCollection<SyncedEventDoc>(
    'synced_events',
    showAllSynced ? [] : cohortId ? [where('cohortId', 'in', [cohortId, 'all'])] : [where('cohortId', '==', 'all')],
    true,
    showAllSynced ? '__staff__' : cohortId ?? 'none',
  )

  const { data: allUsers } = useCollection<UserDoc>('users')
  // Group duplicate docs by displayName, collecting all their IDs — ensures profile.uid always matches
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

  const subjectMap = useMemo(
    () => Object.fromEntries(subjects.map(s => [s.id, s])),
    [subjects],
  )

  // Subject colour → FullCalendar hex
  const subjectHexMap: Record<string, string> = {
    'bg-indigo-500': '#6366f1',
    'bg-violet-500': '#8b5cf6',
    'bg-pink-500':   '#ec4899',
    'bg-sky-500':    '#0ea5e9',
    'bg-teal-500':   '#14b8a6',
    'bg-emerald-500':'#10b981',
    'bg-amber-500':  '#f59e0b',
    'bg-orange-500': '#f97316',
    'bg-rose-500':   '#f43f5e',
  }

  const events: EventInput[] = useMemo(() => {
    const lessonEvents: EventInput[] = lessons.map(l => {
      const color     = subjectHexMap[subjectMap[l.subjectId]?.color ?? ''] ?? '#6366f1'
      const startDate = toDate(l.startTime)
      const endDate   = toDate(l.endTime)

      // Multi-day lesson → promote to all-day row so it doesn't clog the time grid
      const isMultiDay =
        startDate && endDate &&
        startDate.toDateString() !== endDate.toDateString()

      if (isMultiDay && startDate && endDate) {
        // FullCalendar all-day end is exclusive, so advance by one day
        const endExclusive = new Date(endDate)
        endExclusive.setDate(endExclusive.getDate() + 1)
        return {
          id:    `lesson-${l.id}`,
          title: l.title,
          start: startDate.toISOString().slice(0, 10),
          end:   endExclusive.toISOString().slice(0, 10),
          allDay: true,
          backgroundColor: color,
          borderColor:     color,
          extendedProps: { type: 'lesson', classroom: l.classroom, isOnline: l.isOnline, subjectId: l.subjectId, subjectTitle: subjectMap[l.subjectId]?.title },
        }
      }

      return {
        id:    `lesson-${l.id}`,
        title: l.title,
        start: startDate ?? undefined,
        end:   endDate   ?? undefined,
        backgroundColor: color,
        borderColor:     color,
        extendedProps: { type: 'lesson', classroom: l.classroom, isOnline: l.isOnline },
      }
    })

    const deadlineEvents: EventInput[] = assignments
      .filter(a => a.isPublished)
      .map(a => ({
        id:    `assignment-${a.id}`,
        title: `📋 Due: ${a.title}`,
        start: toDate(a.dueDate)   ?? undefined,
        allDay: true,
        backgroundColor: '#f43f5e',
        borderColor:     '#f43f5e',
        extendedProps: {
          type: 'assignment',
          description: a.description,
          pointsValue: a.pointsValue,
          subjectTitle: subjectMap[a.subjectId]?.title,
          subjectColor: subjectMap[a.subjectId]?.color,
          dueDate: toDate(a.dueDate),
        },
      }))

    // Semester markers — cohort-specific dates take priority over global
    const semDates = {
      sem1Start: myCohort?.semesterStartDate     ?? semesterDoc?.startDate,
      sem1End:   myCohort?.semesterEndDate       ?? semesterDoc?.endDate,
      sem2Start: myCohort?.semesterSem2StartDate ?? semesterDoc?.sem2Start,
      sem2End:   myCohort?.semesterSem2EndDate   ?? semesterDoc?.sem2End,
    }
    const semEvents = semesterMarkers(semDates)

    return [...lessonEvents, ...deadlineEvents, ...semEvents]
  }, [lessons, assignments, subjectMap, myCohort, semesterDoc])

  const personalEventInputs: EventInput[] = useMemo(() => {
    const color = (profile as any)?.calendarColor ?? '#86bbd8'
    return myPersonalEvents.map(e => ({
      id:    `personal-${e.id}`,
      title: e.title,
      start: toDate(e.startTime) ?? undefined,
      end:   e.endTime ? toDate(e.endTime) ?? undefined : undefined,
      allDay: e.allDay,
      backgroundColor: color,
      borderColor:     color,
      extendedProps: { isPersonal: true, docId: e.id },
    }))
  }, [myPersonalEvents, profile])

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

  const cohortColorMap = useMemo(
    () => Object.fromEntries(cohorts.map(c => [c.id, c.color ?? '#0078d4'])),
    [cohorts],
  )

  const syncedEventInputs: EventInput[] = useMemo(() => {
    return syncedEvents.map(e => {
      const color = e.cohortId === 'all' ? '#0078d4' : (cohortColorMap[e.cohortId] ?? '#0078d4')
      return {
        id:    `synced-${e.id}`,
        title: `📅 ${e.customTitle || e.title}`,
        start: toDate(e.startTime) ?? undefined,
        end:   e.endTime ? toDate(e.endTime) ?? undefined : undefined,
        allDay: e.allDay,
        backgroundColor: color,
        borderColor:     color,
        extendedProps: {
          isSynced: true,
          docId: e.id,
          location: e.customLocation || e.location,
          subjectId: e.subjectId ?? null,
          teacherIds: e.teacherIds ?? [],
          notes: e.notes ?? null,
        },
      }
    })
  }, [syncedEvents, cohortColorMap])

  const allEvents = useMemo(
    () => [...events, ...personalEventInputs, ...invitedEventInputs, ...syncedEventInputs],
    [events, personalEventInputs, invitedEventInputs, syncedEventInputs],
  )

  function resetAddEventForm() {
    setAddEventModal(null)
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

  async function savePersonalEvent() {
    if (!profile || !newEventTitle.trim() || !addEventModal) return
    setSavingPersonal(true)
    const title    = newEventTitle.trim()
    const location = newEventLocation.trim()
    const invitees = Object.values(newEventInvitees).flat()
    try {
      const { date, start, end, allDay } = addEventModal
      const startTime = allDay
        ? Timestamp.fromDate(new Date(`${date}T00:00:00`))
        : Timestamp.fromDate(new Date(`${date}T${start}:00`))
      const endTime = allDay ? null : Timestamp.fromDate(new Date(`${date}T${end}:00`))
      const eventRef = await addDoc(collection(db, 'personal_events'), {
        userId:        profile.uid,
        organizerName: profile.displayName,
        role:          'student',
        title,
        startTime,
        endTime,
        allDay,
        location:      location || null,
        notes:         newEventNotes.trim() || null,
        inviteeIds:    invitees,
        createdAt:     serverTimestamp(),
      })
      resetAddEventForm()
      if (invitees.length > 0) {
        const fn = httpsCallable(functions, 'sendEventInviteNotifications')
        fn({
          eventId:       eventRef.id,
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

  useEffect(() => {
    if (profile?.uid) markCalendarInvitesSeen(profile.uid)
  }, [profile?.uid])

  function openEditEvent(event: PersonalEventDoc) {
    const startDate = event.startTime?.toDate?.()
    const endDate   = event.endTime?.toDate?.()
    setEditingEvent(event)
    setEditTitle(event.title)
    setEditLocation(event.location ?? '')
    setEditNotes(event.notes ?? '')
    setEditDate(startDate ? format(startDate, 'yyyy-MM-dd') : '')
    setEditStart(startDate && !event.allDay ? format(startDate, 'HH:mm') : '')
    setEditEnd(endDate && !event.allDay ? format(endDate, 'HH:mm') : '')
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
    if (!editingEvent || !editTitle.trim() || !profile) return
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
        title: editTitle.trim(), location: editLocation.trim() || null,
        notes: editNotes.trim() || null, startTime, endTime,
        inviteeIds: newIds,
      })
      const fn = httpsCallable(functions, 'sendEventInviteNotifications')
      if (removedIds.length > 0) {
        fn({ eventId: editingEvent.id, inviteeIds: removedIds, organizerName: profile.displayName,
          title: editTitle.trim(), canceled: true,
        }).catch(e => console.error('cancel notify failed', e))
      }
      if (addedIds.length > 0) {
        fn({ eventId: editingEvent.id, inviteeIds: addedIds, organizerName: profile.displayName,
          title: editTitle.trim(), dateStr: editDate,
          timeStr: editingEvent.allDay ? 'All day' : editStart,
          location: editLocation.trim(),
        }).catch(e => console.error('invite notify failed', e))
      }
      closeEditEvent()
    } finally {
      setSavingEdit(false)
    }
  }

  async function deleteEditEvent() {
    if (!editingEvent || !confirm('Delete this event?')) return
    setSavingEdit(true)
    try {
      const allIds = editingEvent.inviteeIds ?? []
      await deleteDoc(doc(db, 'personal_events', editingEvent.id))
      if (allIds.length > 0 && profile) {
        const fn = httpsCallable(functions, 'sendEventInviteNotifications')
        fn({ eventId: editingEvent.id, inviteeIds: allIds, organizerName: profile.displayName,
          title: editingEvent.title, dateStr: editDate,
          timeStr: editingEvent.allDay ? 'All day' : editStart,
          location: editingEvent.location ?? '', canceled: true,
        }).catch(e => console.error('cancel notify failed', e))
      }
      closeEditEvent()
    } finally {
      setSavingEdit(false)
    }
  }

  const hasSemester = !!(semesterDoc?.startDate && semesterDoc?.endDate)

  return (
    <div className="space-y-4">

      {/* ── Desktop header (hidden on mobile) ───────────────────────────── */}
      <div className="hidden sm:flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="text-zinc-500 text-sm mt-1">Your lessons and deadlines at a glance.</p>
        </div>
        {hasSemester && (
          <div className="flex gap-1 bg-zinc-800 rounded-xl p-1">
            <button
              onClick={() => setShowWheel(false)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${!showWheel ? 'bg-zinc-900 shadow-sm text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Calendar
            </button>
            <button
              onClick={() => setShowWheel(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${showWheel ? 'bg-zinc-900 shadow-sm text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <Circle className="w-3.5 h-3.5" />
              Annual Plan
            </button>
          </div>
        )}
      </div>

      {/* ── Mobile compact toolbar (hidden on desktop and landscape) ──────── */}
      <div className="sm:hidden landscape:hidden flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Calendar</h1>
          {hasSemester && (
            <div className="flex gap-0.5 bg-zinc-800 rounded-lg p-0.5">
              <button
                onClick={() => setShowWheel(false)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${!showWheel ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}
              >
                Cal
              </button>
              <button
                onClick={() => setShowWheel(true)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${showWheel ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500'}`}
              >
                <Circle className="w-3 h-3" />
                Plan
              </button>
            </div>
          )}
        </div>

        {/* View dropdown — only shown when in calendar mode */}
        {!showWheel && (
          <div className="relative">
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
                      const api = calendarRef.current?.getApi()
                      if (api) {
                        if (v.id === 'timeGridDay') api.gotoDate(new Date())
                        api.changeView(v.id)
                      }
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
        )}
      </div>

      {showWheel && hasSemester ? (
        <div className="card py-2 px-0 sm:py-8 sm:px-8">
          <AnnualPlanWheel
            lessons={lessons}
            subjects={subjects}
            categories={categories}
            sem1Start={semesterDoc!.startDate}
            sem1End={semesterDoc!.endDate}
            sem2Start={semesterDoc?.sem2Start}
            sem2End={semesterDoc?.sem2End}
          />
        </div>
      ) : (
        <>
          {/* Legend — desktop only */}
          <div className="hidden sm:flex items-center gap-4 flex-wrap">
            {subjects.map(s => (
              <div key={s.id} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: subjectHexMap[s.color] ?? '#6366f1' }} />
                <span className="text-xs text-zinc-400">{s.iconEmoji} {s.title}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500 flex-shrink-0" />
              <span className="text-xs text-zinc-400">Deadline</span>
            </div>
            {myPersonalEvents.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: (profile as any)?.calendarColor ?? '#86bbd8' }} />
                <span className="text-xs text-zinc-400">My events</span>
              </div>
            )}
            {invitedPersonalEvents.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-slate-500" />
                <span className="text-xs text-zinc-400">Invited</span>
              </div>
            )}
            {(() => {
              const usedCohortIds = Array.from(new Set(syncedEvents.map(e => e.cohortId)))
              return usedCohortIds.map(cid => {
                const color = cid === 'all' ? '#0078d4' : (cohortColorMap[cid] ?? '#0078d4')
                const label = cid === 'all'
                  ? 'Outlook (all)'
                  : `Outlook · ${cohorts.find(c => c.id === cid)?.name ?? 'Cohort'}`
                return (
                  <div key={`synced-legend-${cid}`} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs text-zinc-400">{label}</span>
                  </div>
                )
              })
            })()}
          </div>

          <div
            ref={calendarCardRef}
            style={{ touchAction: 'pan-y' }}
            className="card p-0 overflow-hidden [&_.fc-toolbar]:flex-wrap [&_.fc-toolbar]:gap-y-2 [&_.fc-toolbar-title]:text-base [&_.fc-button]:text-xs [&_.fc-button]:px-2 [&_.fc-button]:py-1 sm:[&_.fc-button]:text-sm sm:[&_.fc-button]:px-3 sm:[&_.fc-button]:py-1.5 [&_.fc-timegrid-slot-label-cushion]:text-[10px] [&_.fc-timegrid-axis-cushion]:text-[10px] [&_.fc-timegrid-axis]:w-8 [&_.fc-col-header-cell-cushion]:text-xs [&_.fc-timegrid-axis-frame]:items-start [&_.fc-timegrid-axis-frame]:pt-1 [&_.fc-daygrid-week-number]:text-[9px] [&_.fc-daygrid-week-number]:leading-tight [&_.fc-daygrid-week-number]:p-0.5 [&_.fc-week-number]:w-5 [&_.fc-view-harness]:overflow-visible"
          >
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={typeof window !== 'undefined' && window.innerWidth < 768 ? 'timeGridWeek' : 'timeGridWeek'}
              firstDay={1}
              weekNumbers={true}
              weekNumberContent={(arg) => `W${arg.num}`}
              headerToolbar={
                isMobileDim
                  ? isLandscape
                    ? { left: 'prev,next', center: 'title', right: 'timeGridDay,timeGridWeek' }
                    : { left: 'prev,next', center: 'title', right: '' }
                  : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridWorkWeek,timeGridDay' }
              }
              views={{
                timeGridWorkWeek: {
                  type:       'timeGrid',
                  duration:   { weeks: 1 },
                  hiddenDays: [0, 6],
                  buttonText: 'Work week',
                },
                timeGridWeek: {
                  buttonText: 'Week',
                },
                dayGridMonth: {
                  buttonText: 'Month',
                },
                timeGridDay: {
                  buttonText: 'Day',
                },
              }}
              eventContent={renderEventContent}
              events={allEvents}
              height={
                isMobileDim
                  ? isLandscape
                    ? 'calc(100dvh - 5.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))'
                    : 'calc(100dvh - 13.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))'
                  : 'calc(100vh - 180px)'
              }
              slotMinTime="00:00:00"
              slotMaxTime="24:00:00"
              scrollTime={scrollTime}
              allDaySlot={true}
              allDayText="ALL DAY"
              dayMaxEventRows={2}
              nowIndicator={true}
              dayHeaderFormat={{ weekday: 'short', day: 'numeric' }}
              eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
              slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
              selectable={true}
              selectMirror={true}
              select={(info) => {
                // drag-to-create: use the dragged range
                if (info.view.type === 'dayGridMonth') return
                const date  = info.startStr.slice(0, 10)
                const start = info.startStr.includes('T') ? info.startStr.slice(11, 16) : '00:00'
                const end   = info.endStr.includes('T') ? info.endStr.slice(11, 16) : '00:00'
                setAddEventModal({ date, start, end, allDay: info.allDay })
              }}
              dateClick={(info) => {
                // single tap / click on an empty slot — works on mobile
                if (info.view.type === 'dayGridMonth') return
                const date  = info.dateStr.slice(0, 10)
                const start = info.dateStr.includes('T') ? info.dateStr.slice(11, 16) : '00:00'
                const d     = new Date(info.date)
                d.setHours(d.getHours() + 1)
                const end   = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
                setAddEventModal({ date, start, end, allDay: info.allDay })
              }}
              eventClick={(info) => {
                if (info.event.extendedProps.isSynced) {
                  const ep = info.event.extendedProps
                  const subj = ep.subjectId ? subjects.find(s => s.id === ep.subjectId) : undefined
                  const teachers = (ep.teacherIds as string[] ?? [])
                    .map(tid => allUsers.find(u => u.uid === tid || u.id === tid)?.displayName)
                    .filter(Boolean) as string[]
                  setSelectedEvent({
                    type: 'synced',
                    title: info.event.title.replace(/^📅 /, ''),
                    startTime: info.event.start ?? undefined,
                    endTime:   info.event.end   ?? undefined,
                    location:  ep.location,
                    subjectTitle: subj?.title,
                    subjectId: ep.subjectId ?? undefined,
                    overrideTeachers: teachers.length > 0 ? teachers : undefined,
                    overrideNotes: ep.notes ?? undefined,
                  })
                  return
                }
                if (info.event.extendedProps.isSemesterMarker) {
                  setSelectedEvent({
                    type: 'semesterMarker',
                    title: info.event.title,
                    startTime: info.event.start ?? undefined,
                  })
                  return
                }
                if (info.event.extendedProps.isPersonal) {
                  const docId: string = info.event.extendedProps.docId
                  if (info.event.extendedProps.isInvited) {
                    const ev = invitedPersonalEvents.find(e => e.id === docId) ?? null
                    setViewingInvitedEvent(ev)
                  } else {
                    const ev = myPersonalEvents.find(e => e.id === docId) ?? null
                    if (ev) openEditEvent(ev)
                  }
                  return
                }
                const p = info.event.extendedProps
                if (p.type === 'lesson') {
                  const rawId   = info.event.id
                  const lessonId = rawId.startsWith('lesson-') ? rawId.slice(7) : rawId
                  // Live-lookup so we always have up-to-date subject data
                  const lesson  = lessons.find(l => l.id === lessonId)
                  const subject = lesson ? subjects.find(s => s.id === lesson.subjectId) : undefined
                  setSelectedEvent({
                    type: 'lesson',
                    lessonId,
                    title: info.event.title,
                    classroom: p.classroom,
                    isOnline: p.isOnline,
                    startTime: info.event.start ?? undefined,
                    endTime:   info.event.end   ?? undefined,
                    subjectId:    subject?.id ?? p.subjectId ?? undefined,
                    subjectTitle: subject?.title ?? p.subjectTitle ?? undefined,
                  })
                } else if (p.type === 'assignment') {
                  setSelectedEvent({
                    type: 'assignment',
                    title: info.event.title.replace(/^📋 Due: /, ''),
                    description: p.description,
                    pointsValue: p.pointsValue,
                    subjectTitle: p.subjectTitle,
                    dueDate: p.dueDate,
                  })
                }
              }}
            />
          </div>
        </>
      )}
      {/* Event detail modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setSelectedEvent(null) }}
        >
          <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div className="flex items-center gap-2">
                {selectedEvent.type === 'lesson'
                  ? <CalendarDays className="w-4 h-4 text-brand-500" />
                  : selectedEvent.type === 'semesterMarker'
                    ? <CalendarDays className="w-4 h-4 text-emerald-500" />
                    : selectedEvent.type === 'synced'
                      ? <CalendarDays className="w-4 h-4" style={{ color: '#0078d4' }} />
                      : <BookOpen className="w-4 h-4 text-rose-500" />
                }
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  {selectedEvent.type === 'lesson' ? 'Lesson' : selectedEvent.type === 'semesterMarker' ? 'Semester' : selectedEvent.type === 'synced' ? 'Outlook Calendar' : 'Assignment Deadline'}
                </span>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <h2 className="text-lg font-bold text-zinc-100">{selectedEvent.title}</h2>
              {selectedEvent.type === 'lesson' && (
                <>
                  {(selectedEvent.startTime || selectedEvent.endTime) && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Clock className="w-4 h-4 text-zinc-400" />
                      <span>
                        {selectedEvent.startTime ? format(selectedEvent.startTime, 'EEEE d MMM · HH:mm') : ''}
                        {selectedEvent.endTime ? ` – ${format(selectedEvent.endTime, 'HH:mm')}` : ''}
                      </span>
                    </div>
                  )}
                  {(selectedEvent.classroom || selectedEvent.isOnline) && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      {selectedEvent.isOnline
                        ? <span className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded-full text-xs font-medium">Online</span>
                        : <span className="text-zinc-500">📍 {selectedEvent.classroom}</span>
                      }
                    </div>
                  )}
                  {selectedEvent.subjectTitle && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <BookOpen className="w-4 h-4 text-zinc-500" />
                      {selectedEvent.subjectId ? (
                        <Link to={`/subjects/${selectedEvent.subjectId}`} className="text-brand-400 hover:underline" onClick={() => setSelectedEvent(null)}>
                          {selectedEvent.subjectTitle}
                        </Link>
                      ) : (
                        <span>{selectedEvent.subjectTitle}</span>
                      )}
                    </div>
                  )}
                  {selectedEvent.lessonId && (
                    <div className="pt-1 border-t border-white/8">
                      <LessonAttendancePanel
                        lessonId={selectedEvent.lessonId}
                        cohortId={cohortId}
                      />
                    </div>
                  )}
                </>
              )}
              {selectedEvent.type === 'synced' && (
                <>
                  {(selectedEvent.startTime || selectedEvent.endTime) && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Clock className="w-4 h-4 text-zinc-400" />
                      <span>
                        {selectedEvent.startTime ? format(selectedEvent.startTime, 'EEEE d MMM · HH:mm') : ''}
                        {selectedEvent.endTime ? ` – ${format(selectedEvent.endTime, 'HH:mm')}` : ''}
                      </span>
                    </div>
                  )}
                  {selectedEvent.location && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <MapPin className="w-4 h-4 flex-shrink-0" />
                      <span>{selectedEvent.location}</span>
                    </div>
                  )}
                  {selectedEvent.subjectTitle && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <BookOpen className="w-4 h-4 flex-shrink-0" />
                      {selectedEvent.subjectId ? (
                        <Link to={`/subjects/${selectedEvent.subjectId}`} className="text-brand-400 hover:underline" onClick={() => setSelectedEvent(null)}>{selectedEvent.subjectTitle}</Link>
                      ) : (
                        <span>{selectedEvent.subjectTitle}</span>
                      )}
                    </div>
                  )}
                  {selectedEvent.overrideTeachers && selectedEvent.overrideTeachers.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <span className="text-zinc-500">👤</span>
                      <span>{selectedEvent.overrideTeachers.join(', ')}</span>
                    </div>
                  )}
                  {selectedEvent.overrideNotes && (
                    <p className="text-sm text-zinc-500 leading-relaxed">{selectedEvent.overrideNotes}</p>
                  )}
                </>
              )}
              {selectedEvent.type === 'semesterMarker' && selectedEvent.startTime && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Clock className="w-4 h-4 text-zinc-400" />
                  <span>{format(selectedEvent.startTime, 'EEEE d MMMM yyyy')}</span>
                </div>
              )}
              {selectedEvent.type === 'assignment' && (
                <>
                  {selectedEvent.dueDate && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Clock className="w-4 h-4 text-rose-400" />
                      <span>Due {format(selectedEvent.dueDate, 'EEEE d MMM yyyy')}</span>
                    </div>
                  )}
                  {selectedEvent.subjectTitle && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <BookOpen className="w-4 h-4 text-zinc-400" />
                      <span>{selectedEvent.subjectTitle}</span>
                    </div>
                  )}
                  {selectedEvent.pointsValue !== undefined && (
                    <p className="text-sm font-semibold text-amber-600">+{selectedEvent.pointsValue} points</p>
                  )}
                  {selectedEvent.description && (
                    <p className="text-sm text-zinc-500 leading-relaxed">{selectedEvent.description}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add personal event modal ─────────────────────────────────────── */}
      {addEventModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={resetAddEventForm}>
          <div className="relative rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Personal Event</p>
              <button onClick={resetAddEventForm} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              <input
                autoFocus
                value={newEventTitle}
                onChange={e => setNewEventTitle(e.target.value)}
                className="input text-sm"
                placeholder="Title *"
              />
              <div>
                <label className="label text-xs">Date</label>
                <input
                  type="date"
                  value={addEventModal.date}
                  onChange={e => setAddEventModal(prev => prev ? { ...prev, date: e.target.value } : null)}
                  className="input text-sm"
                />
              </div>
              {!addEventModal.allDay && (
                <div className="grid grid-cols-2 gap-2">
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
              )}
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

              <button
                disabled={!newEventTitle.trim() || savingPersonal}
                className="w-full btn-primary py-2.5 text-sm disabled:opacity-50"
                onClick={savePersonalEvent}
              >
                {savingPersonal ? 'Saving…' : Object.keys(newEventInvitees).length > 0 ? `Save & Invite ${Object.keys(newEventInvitees).length}` : 'Add to My Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit personal event modal ─────────────────────────────────────── */}
      {editingEvent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={closeEditEvent}>
          <div className="relative rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Edit Event</p>
              <div className="flex items-center gap-1">
                <button onClick={deleteEditEvent} disabled={savingEdit} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500 transition-colors disabled:opacity-40">
                  <Trash2 className="w-4 h-4" />
                </button>
                <button onClick={closeEditEvent} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              <input
                autoFocus
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                className="input text-sm"
                placeholder="Title *"
              />
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

              <button
                disabled={!editTitle.trim() || savingEdit}
                className="w-full btn-primary py-2.5 text-sm disabled:opacity-50"
                onClick={saveEditEvent}
              >
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invited event detail modal ────────────────────────────────────── */}
      {viewingInvitedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setViewingInvitedEvent(null)}
        >
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
                  <Clock className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {viewingInvitedEvent.allDay
                      ? format(viewingInvitedEvent.startTime.toDate(), 'EEEE d MMM') + ' · All day'
                      : format(viewingInvitedEvent.startTime.toDate(), 'EEEE d MMM · HH:mm')
                        + (viewingInvitedEvent.endTime ? ` – ${format(viewingInvitedEvent.endTime.toDate(), 'HH:mm')}` : '')
                    }
                  </span>
                </div>
              )}
              {viewingInvitedEvent.location && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  <span>{viewingInvitedEvent.location}</span>
                </div>
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
