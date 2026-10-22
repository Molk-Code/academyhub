import { Link } from 'react-router-dom'
import { Clock, MapPin, Video, AlertTriangle, ChevronRight } from 'lucide-react'
import { cn, shortDate, timeStr } from '@/lib/utils'
import { coverImageUrl } from '@/lib/cloudinary'
import type { LessonDoc, AssignmentDoc, SubjectDoc } from '@/types'

// ─── Subject thumbnail ───────────────────────────────────────────────────────

// Small square tile: the subject's cover image, or its colour with the emoji.
export function SubjectThumb({ subject, fallbackEmoji = '🎬', className }: {
  subject?: Pick<SubjectDoc, 'imageUrl' | 'color' | 'iconEmoji'>
  fallbackEmoji?: string
  className?: string
}) {
  return (
    <div className={cn('w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center', !subject?.imageUrl && (subject?.color ?? 'bg-zinc-800'), className)}>
      {subject?.imageUrl
        ? <img src={coverImageUrl(subject.imageUrl, 120, 120)} alt="" loading="lazy" className="w-full h-full object-cover" />
        : <span className="text-lg leading-none">{subject?.iconEmoji ?? fallbackEmoji}</span>}
    </div>
  )
}

// ─── Lesson card ─────────────────────────────────────────────────────────────

interface LessonCardProps {
  lesson: LessonDoc
  subject?: SubjectDoc
}

export function LessonCard({ lesson, subject }: LessonCardProps) {
  return (
    <Link to="/calendar" className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-colors">
      <SubjectThumb subject={subject} fallbackEmoji={lesson.iconEmoji} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-100 truncate">{lesson.title}</p>
        <div className="flex flex-wrap gap-y-0.5 items-center gap-x-3 text-xs mt-0.5">
          <span className="flex items-center gap-1 text-brand-300 font-medium whitespace-nowrap">
            <Clock className="w-3 h-3" />
            {shortDate(lesson.startTime)} · {timeStr(lesson.startTime)}–{timeStr(lesson.endTime)}
          </span>
          <span className="flex items-center gap-1 text-zinc-400 min-w-0">
            {lesson.isOnline
              ? <><Video className="w-3 h-3 flex-shrink-0" /> Online</>
              : <><MapPin className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{lesson.classroom}</span></>
            }
          </span>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
    </Link>
  )
}

// ─── Assignment / deadline card ───────────────────────────────────────────────

interface DeadlineCardProps {
  assignment: AssignmentDoc
  subject?: SubjectDoc
  isOverdue?: boolean
  isDueToday?: boolean
}

export function DeadlineCard({ assignment, subject, isOverdue, isDueToday }: DeadlineCardProps) {
  return (
    <Link
      to={`/assignments/${assignment.id}`}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl transition-colors',
        isOverdue
          ? 'bg-rose-950/40 ring-1 ring-rose-800/50 hover:bg-rose-950/60'
          : isDueToday
          ? 'bg-brand-900/30 ring-1 ring-brand-700/40 hover:bg-brand-900/40'
          : 'bg-zinc-900 hover:bg-zinc-800',
      )}
    >
      <SubjectThumb subject={subject} fallbackEmoji="📝" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-100 truncate">{assignment.title}</p>
          {isOverdue && (
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rose-300 bg-rose-500/15 px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap">
              <AlertTriangle className="w-3 h-3" /> Overdue
            </span>
          )}
          {isDueToday && !isOverdue && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-300 bg-brand-500/15 px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap">
              Due today
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-y-1 items-center gap-x-3 text-xs text-zinc-400 mt-0.5">
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Clock className="w-3 h-3" />
            Due {shortDate(assignment.dueDate)}
          </span>
          <span className="badge badge-indigo">{assignment.type}</span>
          <span className="text-amber-400 font-medium whitespace-nowrap">+{assignment.pointsValue} pts</span>
        </div>
      </div>
    </Link>
  )
}
