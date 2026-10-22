import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { Trash2, Loader2 } from 'lucide-react'
import { functions } from '@/lib/firebase'
import type { SubmissionDoc } from '@/types'

// Two-step delete for a submission (teacher/admin). Goes through the
// deleteSubmission Cloud Function, which also reverses any points awarded.
export default function DeleteSubmissionButton({ submission, studentName, onDeleted }: {
  submission: SubmissionDoc
  studentName?: string
  onDeleted: (pointsReversed: number) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const points = submission.pointsAwarded ?? 0
  const who = studentName ?? 'the student'

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const fn = httpsCallable<{ submissionId: string }, { success: boolean; pointsReversed: number }>(functions, 'deleteSubmission')
      const res = await fn({ submissionId: submission.id })
      onDeleted(res.data.pointsReversed ?? 0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete the submission.')
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-rose-400 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" /> Delete submission
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-rose-800/50 bg-rose-950/40 p-3 space-y-2">
      <p className="text-sm text-rose-200">
        Delete {who}'s submission? This can't be undone
        {points > 0 ? <> and removes the <strong>{points} points</strong> it awarded</> : null}.
        {' '}They'll be able to submit again.
      </p>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="btn bg-rose-600 hover:bg-rose-700 text-white py-1.5 px-3 text-xs focus:ring-rose-500"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button type="button" onClick={() => { setConfirming(false); setError(null) }} disabled={busy} className="btn-ghost py-1.5 px-3 text-xs">
          Cancel
        </button>
      </div>
    </div>
  )
}
