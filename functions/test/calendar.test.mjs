// .ics import (manual fallback for the Outlook sync) against the Firestore emulator.
//   npm --prefix functions test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT ||= 'demo-cineforge'
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(HOST && PROJECT.startsWith('demo-'), 'run via `firebase emulators:exec` against a demo- project')

const { db, admin } = await import('../lib/lib.js')
const { parseIcs } = await import('../lib/calendar-ics.js')
const { applyCalendarSnapshot } = await import('../lib/calendar.js')

const ts = d => admin.firestore.Timestamp.fromDate(d)

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
})

// Shaped like an Outlook export: Windows zone name defined in the file
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:Microsoft Exchange Server 2010
BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:series-1
SUMMARY:Film history
DTSTART;TZID=W. Europe Standard Time:20261102T090000
DTEND;TZID=W. Europe Standard Time:20261102T100000
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=W. Europe Standard Time:20261109T090000
LOCATION:Room 3
END:VEVENT
BEGIN:VEVENT
UID:series-1
RECURRENCE-ID;TZID=W. Europe Standard Time:20261116T090000
SUMMARY:Film history (moved)
DTSTART;TZID=W. Europe Standard Time:20261116T130000
DTEND;TZID=W. Europe Standard Time:20261116T140000
END:VEVENT
BEGIN:VEVENT
UID:single-1
SUMMARY:Premiere
DTSTART;TZID=W. Europe Standard Time:20260701T180000
DTEND;TZID=W. Europe Standard Time:20260701T200000
END:VEVENT
BEGIN:VEVENT
UID:cancelled-1
SUMMARY:Cancelled thing
STATUS:CANCELLED
DTSTART;TZID=W. Europe Standard Time:20261103T090000
END:VEVENT
BEGIN:VEVENT
UID:allday-1
SUMMARY:Study day
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261121
END:VEVENT
END:VCALENDAR`

const FROM = new Date('2026-01-01T00:00:00Z')
const TO = new Date('2027-01-01T00:00:00Z')

test('parseIcs: series expanded, exceptions applied, Outlook zones, cancelled skipped', () => {
  const ev = parseIcs(ICS, FROM, TO)
  const list = [...ev.values()].sort((a, b) => a.start - b.start)
  assert.deepEqual(list.map(e => [e.title, e.start.toISOString()]), [
    ['Premiere', '2026-07-01T16:00:00.000Z'],              // summer: UTC+2
    ['Film history', '2026-11-02T08:00:00.000Z'],          // winter: UTC+1
    // 9 Nov removed by EXDATE
    ['Film history (moved)', '2026-11-16T12:00:00.000Z'],
    ['Study day', '2026-11-20T00:00:00.000Z'],
    ['Film history', '2026-11-23T08:00:00.000Z'],
  ])
  assert.equal(list.find(e => e.title === 'Study day').allDay, true)
  assert.equal(list[1].location, 'Room 3')
  assert.equal(parseIcs(ICS, new Date('2026-11-10T00:00:00Z'), TO).size, 3, 'window applies')
  assert.throws(() => parseIcs('hello', FROM, TO))
})

const stamp = () => ({ lastImportedAt: admin.firestore.FieldValue.serverTimestamp() })

async function seedSync() {
  await db.collection('office_calendar_syncs').doc('s1').set({ name: 'School', cohortId: 'c1', enabled: true, webhookSecret: 'x' })
  // What the Power Automate flow stored: Graph ids, and a teacher override
  await db.collection('synced_events').doc('s1_graphA').set({
    syncId: 's1', externalId: 'graphA', cohortId: 'c1', title: 'Film history',
    startTime: ts(new Date('2026-11-02T08:00:00Z')), endTime: ts(new Date('2026-11-02T09:00:00Z')),
    allDay: false, location: 'Room 3', source: 'office365', subjectId: 'film-history',
  })
  await db.collection('synced_events').doc('s1_graphB').set({
    syncId: 's1', externalId: 'graphB', cohortId: 'c1', title: 'Removed in Outlook',
    startTime: ts(new Date('2026-11-05T08:00:00Z')), allDay: false, location: null, source: 'office365',
  })
}

test('import: matches the flow\'s events by title and start, keeps overrides; dry run writes nothing', async () => {
  await seedSync()
  const events = parseIcs(ICS, FROM, TO)
  const starts = [...events.values()].map(e => e.start.getTime())
  const opts = {
    windowStart: new Date(Math.min(...starts)), windowEnd: new Date(Math.max(...starts) + 1),
    events, force: false, matchByTitle: true, stamp,
  }
  const sync = (await db.collection('office_calendar_syncs').doc('s1').get()).data()

  const dry = await applyCalendarSnapshot('s1', sync, { ...opts, dryRun: true })
  assert.equal(dry.status, 200)
  assert.equal(dry.body.matched, 1)
  assert.equal(dry.body.toDelete, 1)
  assert.equal(dry.body.toAdd, 4)
  assert.equal(dry.body.toUpdate, 0)
  assert.equal((await db.collection('synced_events').get()).size, 2, 'dry run writes nothing')

  const real = await applyCalendarSnapshot('s1', sync, { ...opts, dryRun: false })
  assert.equal(real.status, 200)
  const docs = Object.fromEntries((await db.collection('synced_events').get()).docs.map(d => [d.id, d.data()]))
  assert.equal(docs.s1_graphA.subjectId, 'film-history', 'override kept')
  assert.equal(docs.s1_graphA.externalId, 'graphA', 'flow id kept, so the flow still matches it')
  assert.equal(docs.s1_graphB, undefined, 'removed from Outlook')
  assert.equal(Object.keys(docs).length, 5)
  assert.ok(Object.values(docs).every(d => d.cohortId === 'c1'))
  assert.ok((await db.collection('office_calendar_syncs').doc('s1').get()).data().lastImportedAt)

  // Importing the same file again changes nothing
  const again = await applyCalendarSnapshot('s1', sync, { ...opts, dryRun: false })
  assert.deepEqual([again.body.toAdd, again.body.toUpdate, again.body.toDelete], [0, 0, 0])
})

test('import: refuses to wipe the calendar when nothing matches, unless forced', async () => {
  await seedSync()
  const events = new Map([['other', { title: 'Something else', start: new Date('2026-11-03T08:00:00Z'), end: null, allDay: false, location: null }]])
  const opts = {
    windowStart: new Date('2026-11-01T00:00:00Z'), windowEnd: new Date('2026-11-10T00:00:00Z'),
    events, dryRun: false, matchByTitle: true, stamp,
  }
  const sync = (await db.collection('office_calendar_syncs').doc('s1').get()).data()
  const refused = await applyCalendarSnapshot('s1', sync, { ...opts, force: false })
  assert.equal(refused.status, 409)
  assert.equal((await db.collection('synced_events').get()).size, 2)
  const forced = await applyCalendarSnapshot('s1', sync, { ...opts, force: true })
  assert.equal(forced.status, 200)
  assert.equal((await db.collection('synced_events').get()).size, 1)
})
