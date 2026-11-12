import { useEffect, useState } from 'react'
import { useCollection } from '@/hooks/useFirestore'
import type { OfficeCalendarSyncDoc } from '@/types'
import { syncHealth } from '@/lib/calendarSync'

// Admin only (the configs hold webhook secrets): how many enabled Outlook
// syncs have been silent longer than their warning limit
export function useCalendarSyncAlert(enabled = true): number {
  const { data: syncs } = useCollection<OfficeCalendarSyncDoc>('office_calendar_syncs', [], enabled)
  // Re-check hourly: a sync goes stale with time, not only when the docs change
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3_600_000)
    return () => clearInterval(t)
  }, [])
  return syncs.filter(s => syncHealth(s, now).stale).length
}
