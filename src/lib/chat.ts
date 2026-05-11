import type { ChatChannelDoc, UserRole } from '@/types'
import { emitSeenUpdate } from '@/lib/seenSignal'

export function canAccessChannel(
  ch: ChatChannelDoc,
  uid: string,
  roles: UserRole[],
  cohortId: string | null,
  teamIds: string[],
): boolean {
  if (ch.isDM) return (ch.memberIds ?? []).includes(uid)
  if (roles.includes('admin') || roles.includes('teacher')) return true
  if (ch.isPublic !== false) return true
  if ((ch.allowedRoles ?? []).some(r => roles.includes(r))) return true
  if ((ch.memberIds ?? []).includes(uid)) return true
  if (cohortId && (ch.allowedCohortIds ?? []).includes(cohortId)) return true
  if (teamIds.some(tid => (ch.allowedTeamIds ?? []).includes(tid))) return true
  return false
}

export function markChannelRead(uid: string, channelId: string) {
  localStorage.setItem(`chatRead:${uid}:${channelId}`, Date.now().toString())
  emitSeenUpdate()
}
