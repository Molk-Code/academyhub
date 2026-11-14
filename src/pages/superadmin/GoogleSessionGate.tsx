import { useEffect, useState } from 'react'
import { GoogleAuthProvider, linkWithPopup, reauthenticateWithPopup, unlink } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react'

// Superadmin pages need a Google sign-in from the last 12 hours, with the
// Google account of the superadmin address itself: the rules and functions
// check the same. That puts the Google account's two-step verification in
// front of everything that can create, change or delete customers.
// First time: the button links the Google account to the existing account,
// then a second click confirms. School users never see this.

const SESSION_HOURS = 12

type State = 'checking' | 'ok' | 'needed'

async function sessionOk(): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false
  const t = await user.getIdTokenResult()
  const fresh = Date.now() - new Date(t.authTime).getTime() < SESSION_HOURS * 3600_000
  return t.signInProvider === 'google.com' && fresh
}

export default function GoogleSessionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>('checking')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    sessionOk().then(ok => { if (live) setState(ok ? 'ok' : 'needed') })
    return () => { live = false }
  }, [])

  async function confirm() {
    const user = auth.currentUser
    if (!user?.email) return
    const email = user.email.toLowerCase()
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ login_hint: email, prompt: 'select_account' })
    setBusy(true); setError(''); setMessage('')
    try {
      if (!user.providerData.some(p => p.providerId === 'google.com')) {
        const cred = await linkWithPopup(user, provider)
        const google = cred.user.providerData.find(p => p.providerId === 'google.com')
        if (google?.email?.toLowerCase() !== email) {
          await unlink(cred.user, 'google.com')
          throw new Error(`Use the Google account for ${email}.`)
        }
        // A second popup straight away is blocked by most browsers: ask for one more click
        setMessage('Google account connected. Click once more to confirm.')
        return
      }
      await reauthenticateWithPopup(user, provider)
      await user.getIdToken(true)
      if (await sessionOk()) setState('ok')
      else setError(`Use the Google account for ${email}.`)
    } catch (e: any) {
      const code = e?.code as string | undefined
      setError(
        code === 'auth/popup-blocked' ? 'The browser blocked the Google window. Allow pop-ups for this site and try again.'
        : code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' ? 'The Google window was closed before finishing.'
        : code === 'auth/credential-already-in-use' ? 'That Google account already belongs to another CineForge account.'
        : code === 'auth/user-mismatch' ? `Use the Google account for ${email}.`
        : e?.message ?? 'Could not confirm with Google.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (state === 'checking') return <div className="min-h-screen bg-black" aria-busy="true" />
  if (state === 'ok') return <>{children}</>

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-zinc-900 border border-white/10 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-brand-400 flex-shrink-0" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Confirm with Google</h1>
        </div>
        <p className="text-sm text-zinc-400">
          Superadmin needs a Google sign-in from the last {SESSION_HOURS} hours, with the Google account of {auth.currentUser?.email}.
        </p>
        {message && <p className="text-sm text-emerald-400" aria-live="polite">{message}</p>}
        {error && <p role="alert" className="text-sm text-rose-400 flex items-start gap-1.5"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}</p>}
        <button type="button" onClick={confirm} disabled={busy} className="btn-primary w-full py-2.5">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Confirm with Google
        </button>
      </div>
    </div>
  )
}
