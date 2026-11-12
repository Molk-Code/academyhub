import { useCallback, useMemo, useState } from 'react'
import type { EventInput } from '@fullcalendar/core'

// The calendars mix several sources; colour alone stops working as sources
// grow, so each event also belongs to a category the user can filter on.

export type CalendarCategory = 'lessons' | 'deadlines' | 'outlook' | 'mine'

export const CALENDAR_CATEGORIES: CalendarCategory[] = ['lessons', 'deadlines', 'outlook', 'mine']

/**
 * Which chip an event belongs to. null = not filterable (semester markers;
 * colleagues' events, which keep their own per-teacher toggle).
 */
export function calendarCategory(ev: EventInput): CalendarCategory | null {
  const p = (ev.extendedProps ?? {}) as Record<string, unknown>
  if (p.isSemesterMarker) return null
  if (p.isSynced) return 'outlook'
  if (p.isPersonal) return p.isOwn === false ? null : 'mine'
  if (p.type === 'assignment') return 'deadlines'
  if (p.type === 'lesson' || 'isBlock' in p) return 'lessons'
  return null
}

const STORAGE_PREFIX = 'calendar_filters_'

function load(key: string): Partial<Record<CalendarCategory, boolean>> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

/**
 * Chip state for one calendar, remembered per browser (a convenience — if
 * storage is unavailable every category simply starts on).
 */
export function useCalendarFilters(storageKey: string, events: EventInput[]) {
  const [hidden, setHidden] = useState<Partial<Record<CalendarCategory, boolean>>>(() => load(storageKey))

  const toggle = useCallback((c: CalendarCategory) => {
    setHidden(prev => {
      const next = { ...prev, [c]: !prev[c] }
      try { localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(next)) } catch {}
      return next
    })
  }, [storageKey])

  const showAll = useCallback(() => {
    setHidden({})
    try { localStorage.removeItem(STORAGE_PREFIX + storageKey) } catch {}
  }, [storageKey])

  // Only categories this calendar actually has get a chip
  const counts = useMemo(() => {
    const c: Partial<Record<CalendarCategory, number>> = {}
    for (const ev of events) {
      const cat = calendarCategory(ev)
      if (cat) c[cat] = (c[cat] ?? 0) + 1
    }
    return c
  }, [events])
  const available = CALENDAR_CATEGORIES.filter(c => counts[c] !== undefined)

  const visible = useMemo(
    () => events.filter(ev => { const cat = calendarCategory(ev); return !cat || !hidden[cat] }),
    [events, hidden],
  )

  return { available, counts, isOn: (c: CalendarCategory) => !hidden[c], toggle, showAll, anyHidden: available.some(c => hidden[c]), visible }
}
