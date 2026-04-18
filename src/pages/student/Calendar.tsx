import { useMemo } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin  from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput } from '@fullcalendar/core'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { toDate } from '@/lib/utils'
import type { LessonDoc, AssignmentDoc, SubjectDoc } from '@/types'

export default function StudentCalendar() {
  const { cohortId } = useAuth()

  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    cohortId ? [where('cohortId', '==', cohortId), orderBy('startTime', 'asc')] : [],
    !!cohortId,
  )

  const { data: assignments } = useCollection<AssignmentDoc>(
    'assignments',
    cohortId ? [where('cohortId', '==', cohortId), orderBy('dueDate', 'asc')] : [],
    !!cohortId,
  )

  const { data: subjects } = useCollection<SubjectDoc>('subjects')

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
      const color = subjectHexMap[subjectMap[l.subjectId]?.color ?? ''] ?? '#6366f1'
      return {
        id:    `lesson-${l.id}`,
        title: l.title,
        start: toDate(l.startTime) ?? undefined,
        end:   toDate(l.endTime)   ?? undefined,
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
        extendedProps: { type: 'assignment' },
      }))

    return [...lessonEvents, ...deadlineEvents]
  }, [lessons, assignments, subjectMap])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Calendar</h1>
        <p className="text-slate-500 text-sm mt-1">Your lessons and deadlines at a glance.</p>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {subjects.map(s => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-full ${s.color}`} />
            <span className="text-xs text-slate-600">{s.iconEmoji} {s.title}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-rose-500" />
          <span className="text-xs text-slate-600">Deadline</span>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left:   'prev,next today',
            center: 'title',
            right:  'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          events={events}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          allDaySlot={true}
          nowIndicator={true}
          eventClick={(info) => {
            const { type, classroom, isOnline } = info.event.extendedProps
            if (type === 'lesson') {
              alert(`${info.event.title}\n${isOnline ? 'Online class' : `Room: ${classroom}`}`)
            }
          }}
        />
      </div>
    </div>
  )
}
