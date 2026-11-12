import { describe, expect, it } from 'vitest'
import { syncHealth, DEFAULT_WARN_AFTER_DAYS } from './calendarSync'

const NOW = Date.parse('2026-11-12T12:00:00Z')
const daysAgo = (d: number) => NOW - d * 86_400_000

describe('syncHealth', () => {
  it('the newest of flow event, check-up and import counts', () => {
    const h = syncHealth({ lastReceivedAt: daysAgo(10), lastReconciledAt: daysAgo(1), lastImportedAt: daysAgo(5) }, NOW)
    expect(h).toMatchObject({ stale: false, lastSource: 'check-up', daysSilent: 1 })
  })
  it('warns after the configured number of days', () => {
    expect(syncHealth({ lastReceivedAt: daysAgo(4) }, NOW).stale).toBe(true)
    expect(syncHealth({ lastReceivedAt: daysAgo(4), warnAfterDays: 7 }, NOW).stale).toBe(false)
    expect(syncHealth({ lastReceivedAt: daysAgo(2) }, NOW).warnAfterDays).toBe(DEFAULT_WARN_AFTER_DAYS)
  })
  it('a sync that never received anything warns once it is old enough', () => {
    expect(syncHealth({ createdAt: daysAgo(1) }, NOW).stale).toBe(false)
    expect(syncHealth({ createdAt: daysAgo(5) }, NOW)).toMatchObject({ stale: true, lastActivityAt: null, daysSilent: 5 })
  })
  it('a switched-off sync never warns', () => {
    expect(syncHealth({ enabled: false, lastReceivedAt: daysAgo(30) }, NOW).stale).toBe(false)
  })
  it('accepts Firestore timestamps', () => {
    expect(syncHealth({ lastReceivedAt: { toMillis: () => daysAgo(4) } }, NOW).stale).toBe(true)
  })
})
