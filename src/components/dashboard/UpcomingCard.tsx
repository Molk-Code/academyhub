import { Link } from 'react-router-dom'
import { Clock, MapPin, Video } from 'lucide-react'
import { cn, shortDate, timeStr } from '@/lib/utils'
import type { LessonDoc, AssignmentDoc } from '@/types'
import type { Timestamp } from 'firebase/firestore'

// ─── Lesson card ─────────────────────────────────────────────────────────────

interface LessonCardProps {
  lesson: LessonDoc
  subjectColor?: string
  subjectTitle?: string
}

export function LessonCard({ lesson, subjectColor = 'bg-brand-500', subjectTitle }: LessonCardProps) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-zinc-900 border border-white/8 hover:border-white/10 hover:shadow-sm transition-all">
      <div className={cn('w-1 self-stretch rounded-full flex-shrink-0', subjectColor)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-200 truncate">{lesson.title}</p>
        {subjectTitle && <p className="text-xs text-zinc-400 mb-1">{subjectTitle}</p>}
        <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {shortDate(lesson.startTime)} · {timeStr(lesson.startTime)}–{timeStr(lesson.endTime)}
          </span>
          <span className="flex items-center gap-1">
            {lesson.isOnline
              ? <><Video className="w-3 h-3" /> Online</>
              : <><MapPin className="w-3 h-3" /> {lesson.classroom}</>
            }
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Assignment / deadline card ───────────────────────────────────────────────

interface DeadlineCardProps {
  assignment: AssignmentDoc
  subjectColor?: string
  subjectTitle?: string
  isOverdue?: boolean
}

export function DeadlineCard({ assignment, subjectColor = 'bg-rose-500', subjectTitle, isOverdue }: DeadlineCardProps) {
  return (
    <Link
      to={`/assignments/${assignment.id}`}
      className={cn(
        'flex items-start gap-3 p-4 rounded-xl border transition-all',
        isOverdue
          ? 'bg-rose-950/40 border-rose-800/50 hover:border-rose-700/50'
          : 'bg-zinc-900 border-white/8 hover:border-white/10 hover:shadow-sm',
      )}
    >
      <div className={cn('w-1 self-stretch rounded-full flex-shrink-0', subjectColor)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-200 truncate">{assignment.title}</p>
          {isOverdue && (
            <span className="badge badge-rose flex-shrink-0">Overdue</span>
          )}
        </div>
        {subjectTitle && <p className="text-xs text-zinc-400 mb-1">{subjectTitle}</p>}
        <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Due {shortDate(assignment.dueDate)}
          </span>
          <span className="badge badge-indigo">{assignment.type}</span>
          <span className="text-amber-600 font-medium">+{assignment.pointsValue} pts</span>
        </div>
      </div>
    </Link>
  )
}
