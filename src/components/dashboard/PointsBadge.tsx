import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  totalPoints: number
  pointsRedeemed?: number
  classPoints?: number
  className?: string
}

function AnimatedNumber({ value }: { value: number }) {
  const count   = useMotionValue(0)
  const rounded = useTransform(count, Math.round)
  useEffect(() => {
    const controls = animate(count, value, { duration: 1.2, ease: 'easeOut' })
    return controls.stop
  }, [value, count])
  return <motion.span className="tabular-nums">{rounded}</motion.span>
}

export default function PointsBadge({ totalPoints, pointsRedeemed = 0, classPoints, className }: Props) {
  const available = totalPoints - pointsRedeemed

  return (
    <div className={cn(
      'flex items-center gap-3 bg-amber-950/40 border border-amber-800/50 rounded-2xl px-4 py-2.5',
      className,
    )}>
      <Sparkles className="w-4 h-4 text-amber-500 flex-shrink-0" />
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold text-amber-400 tabular-nums leading-none">
            <AnimatedNumber value={totalPoints} />
          </span>
          <span className="text-sm font-medium text-amber-600">pts</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {pointsRedeemed > 0 && (
            <p className="text-[10px] text-amber-600 leading-none">{available} available</p>
          )}
          {classPoints !== undefined && (
            <p className="text-[10px] text-sky-500 leading-none">
              {pointsRedeemed > 0 ? '·' : ''} class: <AnimatedNumber value={classPoints} />
            </p>
          )}
          {pointsRedeemed === 0 && classPoints === undefined && (
            <p className="text-[10px] text-amber-600 leading-none">earned total</p>
          )}
        </div>
      </div>
    </div>
  )
}
