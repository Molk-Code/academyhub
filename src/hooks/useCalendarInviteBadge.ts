import { useMemo } from 'react'
import { useCollection, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import { useSeenRevision, emitSeenUpdate } from '@/lib/seenSignal'
import type { PersonalEventDoc } from '@/types'

const SEEN_KEY = (uid: string) => `calendarInvitesSeenAt:${uid}`

export function markCalendarInvitesSeen(uid: string) {
  localStorage.setItem(SEEN_KEY(uid), String(Date.now()))
  emitSeenUpdate()
}

export function useCalendarInviteBadge(): number {
  const { profile } = useAuth()
  const seenRev = useSeenRevision()

  const { data: invited } = useCollection<PersonalEventDoc>(
    'personal_events',
    profile ? [where('inviteeIds', 'array-contains', profile.uid)] : [],
    !!profile,
  )

  return useMemo(() => {
    if (!profile?.uid) return 0
    const seenAt = parseInt(localStorage.getItem(SEEN_KEY(profile.uid)) ?? '0', 10)
    return invited.filter(e => (e.createdAt?.toMillis?.() ?? 0) > seenAt).length
  }, [invited, profile?.uid, seenRev])
}
