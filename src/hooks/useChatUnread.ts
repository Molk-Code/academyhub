import { useMemo } from 'react'
import { useCollection, orderBy, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import { canAccessChannel } from '@/lib/chat'
import { useSeenRevision } from '@/lib/seenSignal'
import type { ChatChannelDoc, ProductionTeamDoc } from '@/types'

export function useChatUnreadCount(): number {
  const { profile, roles, cohortId } = useAuth()

  const { data: allChannels } = useCollection<ChatChannelDoc>(
    'chat_channels',
    [orderBy('order', 'asc')],
  )

  const { data: myTeams } = useCollection<ProductionTeamDoc>(
    'production_teams',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId && !!profile,
    cohortId ?? '',
  )

  const myTeamIds = useMemo(
    () => myTeams.filter(t => profile && t.memberIds.includes(profile.uid)).map(t => t.id),
    [myTeams, profile],
  )

  const seenRev = useSeenRevision()

  return useMemo(() => {
    if (!profile) return 0
    const accessible = allChannels.filter(ch =>
      canAccessChannel(ch, profile.uid, roles, profile.cohortId ?? null, myTeamIds),
    )
    const allClearedAt = parseInt(localStorage.getItem(`chatAllClearedAt:${profile.uid}`) ?? '0', 10)
    return accessible.filter(ch => {
      if (!ch.lastMessageAt) return false
      const readKey = `chatRead:${profile.uid}:${ch.id}`
      const perChannel = parseInt(localStorage.getItem(readKey) ?? '0', 10)
      const effectiveRead = Math.max(perChannel, allClearedAt)
      return ch.lastMessageAt.toMillis() > effectiveRead
    }).length
  }, [allChannels, profile, roles, myTeamIds, seenRev])
}
