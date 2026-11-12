import { useMemo } from 'react'
import { useAllUsers } from '@/hooks/useAllUsers'
import { groupUsersByName, type UserGroup } from './scope'

// Students and teachers who can be invited to a calendar event, except me
export function useInvitableUserGroups(myUid: string | null | undefined): UserGroup[] {
  const { data: allUsers } = useAllUsers()
  return useMemo(
    () => groupUsersByName(allUsers, { excludeUid: myUid, roles: ['student', 'teacher'] }),
    [allUsers, myUid],
  )
}
