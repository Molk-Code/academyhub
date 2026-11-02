// Dry-run test of reconcileOfficeCalendar: simulates Outlook returning one
// week of a sync's events minus the 2 Nov TTF occurrence. Changes nothing.
// Usage: node scripts/test-office-reconcile.mjs

import admin from 'firebase-admin'
import { readFileSync } from 'fs'
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)))) })
const db = admin.firestore()
const syncId = 'pwOErqJYagPPgA8NcOeF'
const secret = (await db.doc(`office_calendar_syncs/${syncId}`).get()).data().webhookSecret
const ws = '2026-10-31T00:00:00Z', we = '2026-11-08T00:00:00Z'
const snap = await db.collection('synced_events').where('syncId', '==', syncId).get()
// Simulate Outlook: everything stored in the window except the removed 2 Nov TTF, times in Outlook's zoneless format
const events = snap.docs.map(d => d.data())
  .filter(e => { const t = e.startTime.toDate().toISOString(); return t >= ws && t < we })
  .filter(e => !(/ttf/i.test(e.title) && e.startTime.toDate().toISOString().startsWith('2026-11-02')))
  .map(e => ({ externalId: e.externalId, subject: e.title, start: e.startTime.toDate().toISOString().replace('Z', '0000'), end: e.endTime?.toDate().toISOString().replace('Z', '0000'), location: e.location ?? '', isAllDay: e.allDay ? 'True' : 'False' }))
const r = await fetch(`https://us-central1-academy-hub-c252f.cloudfunctions.net/reconcileOfficeCalendar?syncId=${syncId}&dryRun=1`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
  body: JSON.stringify({ windowStart: ws, windowEnd: we, events }),
})
console.log(r.status, JSON.stringify(await r.json(), null, 1))
process.exit(0)
