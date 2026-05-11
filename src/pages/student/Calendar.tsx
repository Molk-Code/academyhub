import { useMemo, useState, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin  from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput } from '@fullcalendar/core'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument, where, orderBy } from '@/hooks/useFirestore'
import { toDate } from '@/lib/utils'
import type { LessonDoc, AssignmentDoc, SubjectDoc, SemesterSettingsDoc, LessonCategoryDoc, CohortDoc, PersonalEventDoc } from '@/types'
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

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
import { Circle, X, CalendarDays, BookOpen, Clock, ChevronDown, Check } from 'lucide-react'
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
  type: 'lesson' | 'assignment'
  lessonId?: string
  title: string
  classroom?: string
  isOnline?: boolean
  startTime?: Date
  endTime?: Date
  description?: string
  subjectTitle?: string
  subjectColor?: string
  pointsValue?: number
  dueDate?: Date
}

export default function StudentCalendar() {
  const [showWheel, setShowWheel] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null)
  const [mobileView, setMobileView] = useState<ViewId>('timeGridWorkWeek')
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false)
  const [addEventModal, setAddEventModal] = useState<{ date: string; start: string; end: string; allDay: boolean } | null>(null)
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventLocation, setNewEventLocation] = useState('')
  const [newEventNotes, setNewEventNotes] = useState('')
  const [savingPersonal, setSavingPersonal] = useState(false)
  const calendarRef = useRef<FullCalendar>(null)
  const { profile, cohortId: ctxCohortId, previewCohortId } = useAuth()
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

  const { data: subjects }    = useCollection<SubjectDoc>('subjects')
  const { data: categories }  = useCollection<LessonCategoryDoc>('lessonCategories', [orderBy('order', 'asc')])
  const { data: semesterDoc } = useDocument<SemesterSettingsDoc>('settings', 'semester')
  const { data: cohorts }     = useCollection<CohortDoc>('cohorts')
  const myCohort = useMemo(() => cohorts.find(c => c.id === cohortId) ?? null, [cohorts, cohortId])

  const { data: myPersonalEvents } = useCollection<PersonalEventDoc>(
    'personal_events',
    profile ? [where('userId', '==', profile.uid)] : [],
    !!profile,
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
          extendedProps: { type: 'lesson', classroom: l.classroom, isOnline: l.isOnline },
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
      extendedProps: { isPersonal: true },
    }))
  }, [myPersonalEvents, profile])

  const allEvents = useMemo(() => [...events, ...personalEventInputs], [events, personalEventInputs])

  async function savePersonalEvent() {
    if (!profile || !newEventTitle.trim() || !addEventModal) return
    setSavingPersonal(true)
    try {
      const { date, start, end, allDay } = addEventModal
      const startTime = allDay
        ? Timestamp.fromDate(new Date(`${date}T00:00:00`))
        : Timestamp.fromDate(new Date(`${date}T${start}:00`))
      const endTime = allDay ? null : Timestamp.fromDate(new Date(`${date}T${end}:00`))
      await addDoc(collection(db, 'personal_events'), {
        userId:    profile.uid,
        role:      'student',
        title:     newEventTitle.trim(),
        startTime,
        endTime,
        allDay,
        location:  newEventLocation.trim() || null,
        notes:     newEventNotes.trim()    || null,
        createdAt: serverTimestamp(),
      })
      setAddEventModal(null)
      setNewEventTitle('')
      setNewEventLocation('')
      setNewEventNotes('')
    } finally {
      setSavingPersonal(false)
    }
  }

  const hasSemester = !!(semesterDoc?.startDate && semesterDoc?.endDate)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
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

      {showWheel && hasSemester ? (
        <div className="card py-4 px-2 sm:py-8 sm:px-8">
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
          {/* Legend */}
          <div className="flex items-center gap-4 flex-wrap">
            {subjects.map(s => (
              <div key={s.id} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-full ${s.color}`} />
                <span className="text-xs text-zinc-400">{s.iconEmoji} {s.title}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-rose-500" />
              <span className="text-xs text-zinc-400">Deadline</span>
            </div>
            {myPersonalEvents.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: (profile as any)?.calendarColor ?? '#86bbd8' }} />
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

          <div className="card p-0 overflow-hidden [&_.fc-toolbar]:flex-wrap [&_.fc-toolbar]:gap-y-2 [&_.fc-toolbar-title]:text-base [&_.fc-button]:text-xs [&_.fc-button]:px-2 [&_.fc-button]:py-1 sm:[&_.fc-button]:text-sm sm:[&_.fc-button]:px-3 sm:[&_.fc-button]:py-1.5 [&_.fc-timegrid-slot-label-cushion]:text-[10px] [&_.fc-timegrid-axis-cushion]:text-[10px] [&_.fc-timegrid-axis]:w-8 [&_.fc-col-header-cell-cushion]:text-xs [&_.fc-timegrid-axis-frame]:items-start [&_.fc-timegrid-axis-frame]:pt-1">
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
                if (info.event.extendedProps.isPersonal) return
                if (info.event.extendedProps.isSemesterMarker) return
                const p = info.event.extendedProps
                if (p.type === 'lesson') {
                  const rawId = info.event.id // "lesson-{lessonId}"
                  setSelectedEvent({
                    type: 'lesson',
                    lessonId: rawId.startsWith('lesson-') ? rawId.slice(7) : rawId,
                    title: info.event.title,
                    classroom: p.classroom,
                    isOnline: p.isOnline,
                    startTime: info.event.start ?? undefined,
                    endTime:   info.event.end   ?? undefined,
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
                  : <BookOpen className="w-4 h-4 text-rose-500" />
                }
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  {selectedEvent.type === 'lesson' ? 'Lesson' : 'Assignment Deadline'}
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
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    {selectedEvent.isOnline
                      ? <span className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded-full text-xs font-medium">Online</span>
                      : selectedEvent.classroom
                        ? <span className="text-zinc-500">📍 {selectedEvent.classroom}</span>
                        : null
                    }
                  </div>
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => { setAddEventModal(null); setNewEventTitle(''); setNewEventLocation(''); setNewEventNotes('') }}>
          <div className="relative rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Personal Event</p>
              <button onClick={() => { setAddEventModal(null); setNewEventTitle(''); setNewEventLocation(''); setNewEventNotes('') }} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
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
              <button
                disabled={!newEventTitle.trim() || savingPersonal}
                className="w-full btn-primary py-2.5 text-sm disabled:opacity-50"
                onClick={savePersonalEvent}
              >
                {savingPersonal ? 'Saving…' : 'Add to My Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
