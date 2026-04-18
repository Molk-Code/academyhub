import { Flame } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  days: number
  className?: string
}

export default function StreakBadge({ days, className }: Props) {
  const hot = days >= 7

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold',
      hot
        ? 'bg-orange-100 text-orange-600'
        : 'bg-slate-100 text-slate-500',
      className,
    )}>
      <Flame className={cn('w-4 h-4', hot ? 'text-orange-500' : 'text-slate-400')} />
      {days} day{days !== 1 ? 's' : ''} streak
    </div>
  )
}
