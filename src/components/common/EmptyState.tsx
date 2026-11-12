import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  icon?: LucideIcon
  emoji?: string
  /** What is missing, e.g. "No equipment booked yet" */
  title: string
  /** What to do next, e.g. "Book your first item to see it here." */
  description?: string
  /** Custom action node (overrides actionLabel) */
  action?: React.ReactNode
  /** Built-in next step: a link (actionTo) or a button (onAction) */
  actionLabel?: string
  actionTo?: string
  onAction?: () => void
  /** Smaller, for inside cards and panels */
  compact?: boolean
  className?: string
}

/** The one empty state: says what's missing and what to do next */
export default function EmptyState({ icon: Icon, emoji, title, description, action, actionLabel, actionTo, onAction, compact, className }: Props) {
  const next = action ?? (actionLabel && (actionTo
    ? <Link to={actionTo} className={compact ? 'text-sm font-medium text-brand-400 hover:text-brand-300' : 'btn-primary text-sm'}>{actionLabel}</Link>
    : onAction ? <button type="button" onClick={onAction} className={compact ? 'text-sm font-medium text-brand-400 hover:text-brand-300' : 'btn-primary text-sm'}>{actionLabel}</button>
    : null))
  return (
    <div role="status" className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-6 px-4' : 'py-16', className)}>
      {emoji && <span className={cn('block', compact ? 'text-2xl mb-2' : 'text-4xl mb-3')} aria-hidden="true">{emoji}</span>}
      {Icon && !emoji && (
        <div className={cn('bg-zinc-800 flex items-center justify-center', compact ? 'w-10 h-10 rounded-xl mb-2' : 'w-14 h-14 rounded-2xl mb-4')} aria-hidden="true">
          <Icon className={cn('text-zinc-400', compact ? 'w-5 h-5' : 'w-7 h-7')} />
        </div>
      )}
      <h3 className={cn('font-semibold text-zinc-300', compact ? 'text-sm' : 'text-base mb-1')}>{title}</h3>
      {description && <p className={cn('text-zinc-400 max-w-xs', compact ? 'text-xs mt-0.5' : 'text-sm')}>{description}</p>}
      {next && <div className={compact ? 'mt-2' : 'mt-4'}>{next}</div>}
    </div>
  )
}
