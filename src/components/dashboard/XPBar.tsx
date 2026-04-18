import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface Props {
  current: number
  max: number
  label?: string
  color?: string   // Tailwind bg class
  className?: string
}

export default function XPBar({ current, max, label, color = 'bg-brand-500', className }: Props) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0

  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <div className="flex justify-between items-center">
          <span className="text-xs font-medium text-slate-600">{label}</span>
          <span className="text-xs text-slate-400">{current}/{max}</span>
        </div>
      )}
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full', color)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}
