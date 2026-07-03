import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Gift, Lock } from 'lucide-react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { PrizeDoc, PrizeClaimDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import EmptyState from '@/components/common/EmptyState'

export default function Prizes() {
  const { profile, cohortId } = useAuth()
  const [redeeming, setRedeeming] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: prizes, loading } = useCollection<PrizeDoc>('prizes')

  const { data: claims } = useCollection<PrizeClaimDoc>(
    'prize_claims',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
  )

  const claimedPrizeIds = new Set(
    claims.filter(c => c.status !== 'rejected').map(c => c.prizeId),
  )

  const availablePrizes = prizes.filter(p =>
    p.isActive &&
    (!p.cohortIds || p.cohortIds.includes(cohortId ?? '')) &&
    (p.quantity === null || p.quantityClaimed < p.quantity),
  )

  async function redeem(prize: PrizeDoc) {
    if (!profile) return
    if ((profile.totalPoints - profile.pointsRedeemed) < prize.pointsCost) {
      setMessage({ type: 'error', text: "You don't have enough points for this prize." })
      return
    }
    setRedeeming(prize.id)
    setMessage(null)
    try {
      const fn = httpsCallable(functions, 'processRedemption')
      await fn({ prizeId: prize.id })
      setMessage({ type: 'success', text: `"${prize.title}" claimed! Your teacher will fulfil it soon.` })
    } catch (e: unknown) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Redemption failed.' })
    } finally {
      setRedeeming(null)
    }
  }

  if (loading) return <LoadingSpinner />

  const balance = (profile?.totalPoints ?? 0) - (profile?.pointsRedeemed ?? 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Prize Shop</h1>
          <p className="text-zinc-500 text-sm mt-1">Spend your hard-earned points on real rewards.</p>
        </div>
        <div className="card flex items-center gap-2 py-3 px-4">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <div>
            <p className="text-xl font-bold text-amber-400 tabular-nums">{balance}</p>
            <p className="text-xs text-zinc-400">pts available</p>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={cn(
          'p-4 rounded-xl text-sm font-medium',
          message.type === 'success' ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-200' : 'bg-rose-950/40 text-rose-300 border border-rose-200',
        )}>
          {message.text}
        </div>
      )}

      {/* Grid */}
      {availablePrizes.length === 0
        ? <EmptyState icon={Gift} title="No prizes available yet" description="Check back later — your teacher will add rewards soon." />
        : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {availablePrizes.map((prize, i) => {
              const canAfford = balance >= prize.pointsCost
              const alreadyClaimed = claimedPrizeIds.has(prize.id)

              return (
                <motion.div
                  key={prize.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className={cn(
                    'card flex flex-col gap-3',
                    !canAfford && 'opacity-70',
                  )}
                >
                  {prize.imageUrl && (
                    <img src={prize.imageUrl} alt={prize.title} className="w-full h-32 object-cover rounded-xl" />
                  )}
                  {!prize.imageUrl && (
                    <div className="w-full h-24 bg-gradient-to-br from-amber-100 to-amber-200 rounded-xl flex items-center justify-center">
                      <Gift className="w-10 h-10 text-amber-400" />
                    </div>
                  )}

                  <div className="flex-1">
                    <h3 className="font-bold text-zinc-100">{prize.title}</h3>
                    <p className="text-sm text-zinc-500 mt-0.5 line-clamp-2">{prize.description}</p>
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <div className="flex items-center gap-1 text-amber-600 font-bold">
                      <Sparkles className="w-4 h-4" />
                      {prize.pointsCost} pts
                    </div>
                    {alreadyClaimed ? (
                      <span className="badge badge-green">Claimed</span>
                    ) : !canAfford ? (
                      <div className="flex items-center gap-1 text-zinc-400 text-xs">
                        <Lock className="w-3.5 h-3.5" />
                        Need {prize.pointsCost - balance} more pts
                      </div>
                    ) : (
                      <button
                        onClick={() => redeem(prize)}
                        disabled={!!redeeming}
                        className="btn-primary py-1.5 px-4 text-xs"
                      >
                        {redeeming === prize.id ? 'Claiming…' : 'Redeem'}
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )
      }
    </div>
  )
}
