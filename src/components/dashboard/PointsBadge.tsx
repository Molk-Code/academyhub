import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  points: number
  className?: string
}

export default function PointsBadge({ points, className }: Props) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, Math.round)

  useEffect(() => {
    const controls = animate(count, points, { duration: 1.2, ease: 'easeOut' })
    return controls.stop
  }, [points, count])

  return (
    <div className={cn(
      'inline-flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-2xl',
      className,
    )}>
      <Sparkles className="w-4 h-4 text-amber-500" />
      <motion.span className="text-lg font-bold text-amber-700 tabular-nums">
        {rounded}
      </motion.span>
      <span className="text-sm text-amber-600 font-medium">pts</span>
    </div>
  )
}
