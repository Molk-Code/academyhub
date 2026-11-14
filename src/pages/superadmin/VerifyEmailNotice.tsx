import { useState } from 'react'
import { sendEmailVerification } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { MailWarning, Loader2 } from 'lucide-react'

// Superadmin changes (modules, login page profile, deleting a school) are only
// accepted from a verified email address — the server and the rules check it.
// Accounts made with a password start unverified, so saving failed with
// "Superadmin only." This explains it and sends the verification email; after
// clicking the link, "I've verified" refreshes the sign-in so it takes effect.
export default function VerifyEmailNotice() {
  const user = auth.currentUser
  const [verified, setVerified] = useState(!!user?.emailVerified)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'checking'>('idle')
  const [message, setMessage] = useState('')
  if (!user || verified) return null

  async function send() {
    setState('sending'); setMessage('')
    try {
      await sendEmailVerification(user!)
      setState('sent')
      setMessage(`Sent to ${user!.email}. Open the link in it, then come back here.`)
    } catch (e: any) {
      setState('idle')
      setMessage(e?.code === 'auth/too-many-requests' ? 'Sent recently — check your inbox, or try again in a few minutes.' : 'Could not send the email. Try again.')
    }
  }

  async function check() {
    setState('checking'); setMessage('')
    await user!.reload()
    if (auth.currentUser?.emailVerified) {
      await auth.currentUser.getIdToken(true)   // the new token carries email_verified
      setVerified(true)
    } else {
      setState('sent')
      setMessage('Not verified yet. Open the link in the email first.')
    }
  }

  return (
    <div role="status" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <MailWarning className="w-5 h-5 text-amber-300 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 text-sm text-amber-100">
        <p className="font-semibold">Verify your email address to save changes here</p>
        <p className="text-amber-200/80 mt-0.5">Superadmin changes are only accepted from a verified address. {message}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary py-2 px-3 text-sm" onClick={send} disabled={state === 'sending' || state === 'checking'}>
          {state === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />} {state === 'sent' ? 'Send again' : 'Send verification email'}
        </button>
        {state !== 'idle' && state !== 'sending' && (
          <button type="button" className="btn-primary py-2 px-3 text-sm" onClick={check} disabled={state === 'checking'}>
            {state === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />} I've verified
          </button>
        )}
      </div>
    </div>
  )
}
