import { functions } from './lib'
import { pushToTeachersAndAdmins, pushToUser } from './notifications-core'

// ─────────────────────────────────────────────────────────────────────────────
// onBugReportCreated — notify admins/teachers of a new bug report
// ─────────────────────────────────────────────────────────────────────────────

export const onBugReportCreated = functions.firestore
  .document('bug_reports/{id}')
  .onCreate(async (snap) => {
    if (snap.data().notifSent === true) return null
    await snap.ref.update({ notifSent: true })

    const d = snap.data()
    await pushToTeachersAndAdmins(
      '🐛 New bug report',
      `${d.displayName ?? 'Someone'}: ${(d.description ?? '').slice(0, 120)}`,
      '/admin/bug-reports',
    )
    return null
  })

// ─────────────────────────────────────────────────────────────────────────────
// onBugReportUpdated — notify the reporter when their report's status changes
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_MESSAGE: Record<string, { title: string; body: string }> = {
  in_progress: { title: '🔧 Bug report in progress', body: 'Your bug report is now being worked on.' },
  resolved:    { title: '✅ Bug report resolved',     body: 'Your bug report has been resolved.' },
  wont_fix:    { title: '📋 Bug report closed',        body: "Your bug report was reviewed and marked won't fix." },
}

export const onBugReportUpdated = functions.firestore
  .document('bug_reports/{id}')
  .onUpdate(async (change) => {
    const before = change.before.data()
    const after  = change.after.data()
    if (before.status === after.status) return null
    if (after.notifiedStatus === after.status) return null
    await change.after.ref.update({ notifiedStatus: after.status })

    const msg = STATUS_MESSAGE[after.status]
    if (!msg || !after.uid) return null

    await pushToUser(after.uid, msg.title, msg.body, '/profile', 'bug-report-update')
    return null
  })
