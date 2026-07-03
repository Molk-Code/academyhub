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
      'flex items-stretch gap-0 bg-amber-950/40 border border-amber-800/50 rounded-2xl overflow-hidden',
      className,
    )}>
      {/* Available (current) */}
      <div className="flex items-center gap-2 px-4 py-2">
        <Sparkles className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <div>
          <div className="text-lg font-bold text-amber-700 leading-none">
            <AnimatedNumber value={available} />
            <span className="text-sm font-medium ml-1">pts</span>
          </div>
          <p className="text-[10px] text-amber-500 font-medium leading-none mt-0.5">available</p>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px bg-amber-200 my-2" />

      {/* Total earned */}
      <div className="flex items-center px-4 py-2">
        <div>
          <div className="text-sm font-bold text-amber-600 leading-none tabular-nums">
            <AnimatedNumber value={totalPoints} />
            <span className="text-xs font-medium ml-1">pts</span>
          </div>
          <p className="text-[10px] text-amber-400 font-medium leading-none mt-0.5">earned total</p>
        </div>
      </div>

      {/* Class total */}
      {classPoints !== undefined && (
        <>
          <div className="w-px bg-amber-200 my-2" />
          <div className="flex items-center px-4 py-2">
            <div>
              <div className="text-sm font-bold text-sky-400 leading-none tabular-nums">
                <AnimatedNumber value={classPoints} />
                <span className="text-xs font-medium ml-1">pts</span>
              </div>
              <p className="text-[10px] text-sky-500 font-medium leading-none mt-0.5">class total</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
