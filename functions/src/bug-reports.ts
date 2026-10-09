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
// or an admin sends them a message
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
    if (!after.uid) return null

    const statusChanged  = before.status !== after.status && after.notifiedStatus !== after.status
    const beforeMsgCount = before.messages?.length ?? 0
    const afterMsgCount  = after.messages?.length ?? 0
    const messageAdded   = afterMsgCount > beforeMsgCount && after.notifiedMessageCount !== afterMsgCount

    if (!statusChanged && !messageAdded) return null

    const markNotified: Record<string, unknown> = {}
    if (statusChanged) markNotified.notifiedStatus = after.status
    if (messageAdded)  markNotified.notifiedMessageCount = afterMsgCount
    await change.after.ref.update(markNotified)

    const url = after.role === 'teacher' ? '/teacher/bug-reports' : '/bug-reports'

    if (statusChanged) {
      const msg = STATUS_MESSAGE[after.status]
      if (msg) await pushToUser(after.uid, msg.title, msg.body, url, 'bug-report-update')
    }
    if (messageAdded) {
      const latest = after.messages[afterMsgCount - 1]
      await pushToUser(
        after.uid,
        '💬 New reply on your bug report',
        (latest?.text ?? '').slice(0, 120),
        url,
        'bug-report-message',
      )
    }
    return null
  })
