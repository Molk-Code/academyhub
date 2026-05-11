import { useMemo } from 'react'
import { useCollection, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import { useSeenRevision, emitSeenUpdate } from '@/lib/seenSignal'
import type { FoodBoxOrderDoc, MinivanBookingDoc } from '@/types'

const FOOD_SEEN_KEY = (uid: string) => `foodBoxSeenAt:${uid}`
const VAN_SEEN_KEY  = (uid: string) => `minivanSeenAt:${uid}`

export function markFoodBoxSeen(uid: string) {
  localStorage.setItem(FOOD_SEEN_KEY(uid), String(Date.now()))
  emitSeenUpdate()
}

export function markMinivanSeen(uid: string) {
  localStorage.setItem(VAN_SEEN_KEY(uid), String(Date.now()))
  emitSeenUpdate()
}

function useBookingData() {
  const { profile, role } = useAuth()
  const uid = profile?.uid
  const isStaff = role === 'teacher' || role === 'admin'
  const seenRev = useSeenRevision()

  const { data: pendingFood } = useCollection<FoodBoxOrderDoc>(
    'food_box_orders',
    [where('status', '==', 'pending')],
    isStaff,
  )
  const { data: pendingVan } = useCollection<MinivanBookingDoc>(
    'minivan_bookings',
    [where('status', '==', 'pending')],
    isStaff,
  )
  const { data: myFood } = useCollection<FoodBoxOrderDoc>(
    'food_box_orders',
    uid && !isStaff ? [where('studentId', '==', uid)] : [],
    !!uid && !isStaff,
  )
  const { data: myVan } = useCollection<MinivanBookingDoc>(
    'minivan_bookings',
    uid && !isStaff ? [where('studentId', '==', uid)] : [],
    !!uid && !isStaff,
  )

  return { uid, isStaff, seenRev, pendingFood, pendingVan, myFood, myVan }
}

export function useBookingBadge(): number {
  const { uid, isStaff, seenRev, pendingFood, pendingVan, myFood, myVan } = useBookingData()

  return useMemo(() => {
    if (!uid) return 0
    if (isStaff) return pendingFood.length + pendingVan.length
    const foodSeenAt = parseInt(localStorage.getItem(FOOD_SEEN_KEY(uid)) ?? '0', 10)
    const vanSeenAt  = parseInt(localStorage.getItem(VAN_SEEN_KEY(uid))  ?? '0', 10)
    const latestTs = (o: any) => Math.max(
      (o.updatedAt as any)?.toMillis?.() ?? 0,
      (o.createdAt as any)?.toMillis?.() ?? 0,
    )
    const activeFood = myFood.filter(o => o.status !== 'cancelled' && latestTs(o) > foodSeenAt).length
    const activeVan  = myVan.filter(b  => b.status !== 'rejected'  && latestTs(b) > vanSeenAt).length
    return activeFood + activeVan
  }, [uid, isStaff, pendingFood, pendingVan, myFood, myVan, seenRev])
}

/** For admin sidebar: separate pending counts per type */
export function useBookingBadgeDetail(): { food: number; van: number } {
  const { uid, isStaff, seenRev, pendingFood, pendingVan } = useBookingData()

  return useMemo(() => {
    if (!uid || !isStaff) return { food: 0, van: 0 }
    return { food: pendingFood.length, van: pendingVan.length }
  }, [uid, isStaff, pendingFood, pendingVan, seenRev])
}

/** For student Booking tabs: per-tab unseen counts */
export function useStudentBookingTabBadges(): { food: number; van: number } {
  const { uid, isStaff, seenRev, myFood, myVan } = useBookingData()

  return useMemo(() => {
    if (!uid || isStaff) return { food: 0, van: 0 }
    const foodSeenAt = parseInt(localStorage.getItem(FOOD_SEEN_KEY(uid)) ?? '0', 10)
    const vanSeenAt  = parseInt(localStorage.getItem(VAN_SEEN_KEY(uid))  ?? '0', 10)
    const latestTs = (o: any) => Math.max(
      (o.updatedAt as any)?.toMillis?.() ?? 0,
      (o.createdAt as any)?.toMillis?.() ?? 0,
    )
    return {
      food: myFood.filter(o => o.status !== 'cancelled' && latestTs(o) > foodSeenAt).length,
      van:  myVan.filter(b  => b.status !== 'rejected'  && latestTs(b) > vanSeenAt).length,
    }
  }, [uid, isStaff, myFood, myVan, seenRev])
}
