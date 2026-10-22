import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { MapPin, Globe } from 'lucide-react'
import type { LessonDoc, SubjectDoc } from '@/types'
import SubjectCover from '@/components/subjects/SubjectCover'
import { timeStr } from '@/lib/utils'
import { cn } from '@/lib/utils'

// Building blocks for the "Ember" dashboard style: small uppercase section
// labels, KPI tiles, shortcut pills and lesson cards with a subject photo.

export function SectionHeader({ icon: Icon, iconClass = 'text-brand-500', title, right }: {
  icon: LucideIcon
  iconClass?: string
  title: string
  right?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2.5">
      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 min-w-0">
        <Icon className={cn('w-4 h-4 flex-shrink-0', iconClass)} />
        <span className="truncate">{title}</span>
      </h2>
      {right && <div className="text-xs font-semibold flex-shrink-0">{right}</div>}
    </div>
  )
}

export function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-brand-400 hover:text-brand-300 transition-colors">
      {children}
    </Link>
  )
}

export function KpiCard({ icon: Icon, iconClass = 'text-zinc-400', value, label, to, alert = false, highlight = false }: {
  icon: LucideIcon
  iconClass?: string
  value: number | string
  label: string
  to: string
  alert?: boolean      // pulsing ember dot
  highlight?: boolean  // number in ember
}) {
  return (
    <Link
      to={to}
      className="flex flex-col justify-between p-3.5 rounded-xl bg-zinc-900 shadow-sm min-h-[96px] hover:bg-zinc-800 transition-colors active:scale-[0.98]"
    >
      <div className="flex items-center justify-between">
        <Icon className={cn('w-5 h-5', iconClass)} />
        {alert
          ? <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-75 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-brand-500 shadow-[0_0_8px_rgba(255,107,53,0.9)]" />
            </span>
          : <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />}
      </div>
      <div>
        <span className={cn('font-display text-3xl font-bold leading-none tracking-tight block', highlight ? 'text-brand-300' : 'text-zinc-100')}>
          {value}
        </span>
        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block mt-1.5">{label}</span>
      </div>
    </Link>
  )
}

export function ShortcutPill({ to, icon: Icon, iconClass = 'text-brand-400', label }: {
  to: string
  icon: LucideIcon
  iconClass?: string
  label: string
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-200 active:scale-95 transition-all flex-shrink-0"
    >
      <Icon className={cn('w-4 h-4', iconClass)} />
      <span className="text-xs font-medium whitespace-nowrap">{label}</span>
    </Link>
  )
}

// Lesson card with the subject's cover image as a photo header — room badge on
// top, time on the image, then title/description and an optional footer.
export function LessonSlateCard({ lesson, subject, to, footer }: {
  lesson: LessonDoc
  subject?: SubjectDoc
  to?: string
  footer?: ReactNode
}) {
  const cover = subject ?? { imageUrl: undefined, color: 'bg-brand-700', iconEmoji: lesson.iconEmoji ?? '🎬', title: lesson.title }
  const body = (
    <>
      <div className="relative">
        <SubjectCover subject={cover} className="h-28">
          <span className="text-sm font-semibold text-white tabular-nums">
            {timeStr(lesson.startTime)} – {timeStr(lesson.endTime)}
          </span>
        </SubjectCover>
        {(lesson.classroom || lesson.isOnline) && (
          <span className="absolute top-2.5 right-2.5 max-w-[60%] px-2 py-0.5 rounded-full bg-black/45 backdrop-blur-md text-ember-tertiary text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1">
            {lesson.isOnline ? <Globe className="w-3 h-3 flex-shrink-0" /> : <MapPin className="w-3 h-3 flex-shrink-0" />}
            <span className="truncate">{lesson.isOnline ? 'Online' : lesson.classroom}</span>
          </span>
        )}
      </div>
      <div className="p-3.5 flex flex-col gap-2">
        <div>
          <h3 className="font-display text-base font-semibold text-zinc-100 leading-tight">{lesson.title}</h3>
          {subject && <p className="text-xs text-brand-300 mt-0.5 truncate">{subject.title}</p>}
          {lesson.description && <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{lesson.description}</p>}
        </div>
        {footer}
      </div>
    </>
  )
  const className = 'flex flex-col rounded-xl bg-zinc-900 shadow-sm overflow-hidden'
  return to
    ? <Link to={to} className={cn(className, 'hover:ring-1 hover:ring-white/10 transition-shadow')}>{body}</Link>
    : <div className={className}>{body}</div>
}
