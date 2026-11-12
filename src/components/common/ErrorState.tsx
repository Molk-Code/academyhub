import { AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  /** The error from a hook or a catch block — picks friendly wording by code */
  error?: unknown
  /** What failed to load, e.g. "your bookings" */
  what?: string
  onRetry?: () => void
  compact?: boolean
  className?: string
}

function wording(error: unknown, what: string): { title: string; hint: string } {
  const code = String((error as { code?: string })?.code ?? '')
  if (code.endsWith('permission-denied')) return { title: `You don't have access to ${what}`, hint: 'If you think you should, ask your administrator.' }
  if (code.endsWith('unavailable') || (typeof navigator !== 'undefined' && !navigator.onLine)) return { title: `Couldn't load ${what} — you seem to be offline`, hint: 'Check your connection; it will try again when you retry.' }
  return { title: `Couldn't load ${what}`, hint: 'Something went wrong on our side. Try again in a moment.' }
}

/** The one error state: what failed, why (in plain words) and a retry */
export default function ErrorState({ error, what = 'this', onRetry, compact, className }: Props) {
  const { title, hint } = wording(error, what)
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-6 px-4' : 'py-16', className)}>
      <div className={cn('bg-rose-500/10 flex items-center justify-center', compact ? 'w-10 h-10 rounded-xl mb-2' : 'w-14 h-14 rounded-2xl mb-4')} aria-hidden="true">
        <AlertTriangle className={cn('text-rose-400', compact ? 'w-5 h-5' : 'w-7 h-7')} />
      </div>
      <h3 className={cn('font-semibold text-zinc-200', compact ? 'text-sm' : 'text-base mb-1')}>{title}</h3>
      <p className={cn('text-zinc-400 max-w-xs', compact ? 'text-xs mt-0.5' : 'text-sm')}>{hint}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={cn('inline-flex items-center gap-1.5', compact ? 'mt-2 text-sm font-medium text-brand-400 hover:text-brand-300' : 'mt-4 btn-secondary text-sm')}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  )
}
