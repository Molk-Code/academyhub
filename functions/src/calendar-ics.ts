// Reads an .ics export (Outlook "Save calendar", a published calendar link
// saved to a file, …) into the same event shape the Power Automate check-up
// sends, so a teacher can keep the calendar current when the flow has stopped.
// Recurring series are expanded into occurrences, with moved and cancelled
// occurrences applied, between `from` and `to`.
import type ICALType from 'ical.js'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ICAL: typeof ICALType = require('ical.js')

export interface CalendarEvent {
  title: string
  start: Date
  end: Date | null
  allDay: boolean
  location: string | null
}

// A series could repeat forever: stop expanding one after this many occurrences
const MAX_OCCURRENCES_PER_SERIES = 1000

export function parseIcs(text: string, from: Date, to: Date): Map<string, CalendarEvent> {
  const root = new ICAL.Component(ICAL.parse(text))
  if (root.name !== 'vcalendar') throw new Error('Not a calendar file (no VCALENDAR).')

  // Outlook names its own zones ("W. Europe Standard Time") and defines them in the file
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(tz)
    if (zone.tzid && !ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(zone)
  }

  const masters = new Map<string, ICALType.Event>()
  const exceptions: ICALType.Event[] = []
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(vevent)
    if (!ev.uid) continue
    if (ev.isRecurrenceException()) exceptions.push(ev)
    else masters.set(ev.uid, ev)
  }
  const orphans: ICALType.Event[] = []
  for (const ex of exceptions) {
    const master = masters.get(ex.uid)
    if (master) master.relateException(ex)
    else orphans.push(ex)   // a moved occurrence whose series isn't in the file
  }

  const out = new Map<string, CalendarEvent>()
  const cancelled = (ev: ICALType.Event) =>
    String(ev.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED'
  // All-day dates as midnight UTC, like the flow stores them (not the server's zone)
  const toDate = (t: ICALType.Time) => t.isDate ? new Date(Date.UTC(t.year, t.month - 1, t.day)) : t.toJSDate()
  const add = (id: string, ev: ICALType.Event, start: ICALType.Time, end: ICALType.Time | null) => {
    const s = toDate(start)
    if (s < from || s >= to || cancelled(ev)) return
    out.set(id, {
      title:    ev.summary ?? '',
      start:    s,
      end:      end ? toDate(end) : null,
      allDay:   start.isDate,
      location: ev.location || null,
    })
  }

  for (const ev of masters.values()) {
    if (!ev.isRecurring()) { add(ev.uid, ev, ev.startDate, ev.endDate); continue }
    if (cancelled(ev)) continue
    const it = ev.iterator()
    for (let n = 0, t = it.next(); t && n < MAX_OCCURRENCES_PER_SERIES; t = it.next(), n++) {
      if (t.toJSDate() >= to) break
      const d = ev.getOccurrenceDetails(t)
      add(`${ev.uid}/${d.recurrenceId.toICALString()}`, d.item, d.startDate, d.endDate)
    }
  }
  for (const ex of orphans) add(`${ex.uid}/${ex.recurrenceId.toICALString()}`, ex, ex.startDate, ex.endDate)
  return out
}
