import { useState, useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Eye, EyeOff, AlertCircle, ArrowLeft, Package } from 'lucide-react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useSchool } from '@/contexts/SchoolContext'
import LegalFooter from '@/components/LegalFooter'
import firePng from '@/assets/fire.png'
import { usePublicConfig } from '@/lib/publicConfig'
import { publicShopOpen } from '@/lib/features'

const schema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type FormData = z.infer<typeof schema>

export default function Login() {
  const { signIn, user, role, loading } = useAuth()
  const { shortName, modules, productType, publicShop } = useSchool()
  const shopOpen = publicShopOpen({ modules, productType, publicShop })
  // Login page profile (public_config/main); without one, the built-in look
  const { config: profile, loading: profileLoading } = usePublicConfig()
  const displayName = profile?.shortName || profile?.name || shortName
  const accent      = profile?.primaryColor
  const [showInviteHelp, setShowInviteHelp] = useState(false)
  const navigate = useNavigate()
  const [showPw,            setShowPw]            = useState(false)
  const [error,             setError]             = useState('')
  const [showForgotPw,      setShowForgotPw]      = useState(false)
  const [resetEmail,        setResetEmail]        = useState('')
  const [resetMessage,      setResetMessage]      = useState('')
  const [resetError,        setResetError]        = useState('')
  const [resetSending,      setResetSending]      = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (sessionStorage.getItem('auth_disabled')) {
      sessionStorage.removeItem('auth_disabled')
      setError('Your account has been deactivated. Contact your teacher.')
    }
  }, [])

  async function onSubmit(data: FormData) {
    setError('')
    try {
      await signIn(data.email, data.password)
      navigate('/')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed'
      if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setError('Incorrect email or password.')
      } else if (msg.includes('user-disabled')) {
        setError('Your account has been deactivated. Contact your teacher.')
      } else if (msg.includes('deactivated')) {
        setError(msg)
      } else {
        setError('Something went wrong. Please try again.')
      }
    }
  }

  async function handleForgotPassword() {
    const email = resetEmail.trim().toLowerCase()
    if (!email) return
    setResetError('')
    setResetMessage('')
    setResetSending(true)
    try {
      await sendPasswordResetEmail(auth, email, {
        url: `${window.location.origin}/login`,
      })
      setResetMessage('Reset link sent! Check your email inbox.')
    } catch (err: any) {
      console.error('Password reset error:', err)
      if (err?.code === 'auth/invalid-email') {
        setResetError('Invalid email address.')
      } else if (err?.code === 'auth/user-not-found') {
        setResetError('No account found with that email address.')
      } else if (err?.code === 'auth/too-many-requests') {
        setResetError('Too many requests. Please wait a moment and try again.')
      } else {
        setResetError(`Something went wrong (${err?.code ?? 'unknown'}). Try again.`)
      }
    } finally {
      setResetSending(false)
    }
  }

  // Already signed in (old bookmark, mistyped link, or the catch-all route):
  // go to the app instead of showing a login form
  if (!loading && user && role) return <Navigate to="/" replace />

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 overflow-y-auto flex items-start sm:items-center justify-center px-4 py-8">
      <div className="absolute inset-0 opacity-5 pointer-events-none"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-sm"
      >
        <div className="bg-zinc-900 rounded-3xl shadow-2xl p-8">
          {/* Hidden (not removed) until a first-visit profile loads, so a
              customer's brand never flashes the built-in one; same layout */}
          <div className={`flex flex-col items-center mb-8 transition-opacity ${profileLoading ? 'opacity-0' : 'opacity-100'}`}>
            <img src={profile?.logoUrl || firePng} alt={displayName} className="w-14 h-14 object-contain mb-3" />
            <h1 className="text-2xl font-bold text-zinc-100">{displayName}</h1>
            <p className="text-sm text-zinc-500 mt-1">{profile?.tagline || 'Filmmaking Education Platform'}</p>
          </div>

          {!showForgotPw ? (
            /* ── Sign-in form ── */
            <>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    {...register('email')}
                    type="email"
                    autoComplete="email"
                    placeholder="you@school.com"
                    className="input"
                    style={{ fontSize: 16 }}
                  />
                  {errors.email && <p className="text-xs text-rose-500 mt-1">{errors.email.message}</p>}
                </div>

                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <input
                      {...register('password')}
                      type={showPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="input pr-10"
                      style={{ fontSize: 16 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>}
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-800/50 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                    <p className="text-sm text-rose-600">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary w-full py-3 text-base mt-2"
                  style={accent ? { backgroundColor: accent } : undefined}
                >
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => { setShowForgotPw(true); setResetEmail(''); setResetMessage(''); setResetError('') }}
                className="w-full text-sm text-zinc-500 hover:text-brand-400 transition-colors mt-4 text-center"
              >
                Forgot your password?
              </button>
            </>
          ) : (
            /* ── Forgot password form ── */
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setShowForgotPw(false)}
                className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors mb-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </button>

              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Reset your password</h2>
                <p className="text-sm text-zinc-500 mt-1">Enter your email and we'll send you a reset link.</p>
              </div>

              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  placeholder="you@school.com"
                  className="input w-full"
                  autoComplete="email"
                  autoFocus
                  style={{ fontSize: 16 }}
                  onKeyDown={e => e.key === 'Enter' && handleForgotPassword()}
                />
              </div>

              {resetError && (
                <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-800/50 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <p className="text-sm text-rose-600">{resetError}</p>
                </div>
              )}
              {resetMessage && (
                <p className="text-sm text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 rounded-xl px-3 py-2.5 text-center">
                  {resetMessage}
                </p>
              )}

              <button
                onClick={handleForgotPassword}
                disabled={resetSending || !resetEmail.trim() || !!resetMessage}
                className="btn-primary w-full py-3 text-base disabled:opacity-50"
              >
                {resetSending ? 'Sending…' : 'Send reset link'}
              </button>
            </div>
          )}

          {/* "Setting up a new school? Register here" (/signup) hidden until the multi-school launch */}
          {/* Secondary actions depend on the customer's front door */}
          {!showForgotPw && !profile?.frontDoor && (
            <p className="text-center text-xs text-zinc-400 mt-6">
              No account yet? Your teacher will send you an invite link.
            </p>
          )}
          {!showForgotPw && profile?.frontDoor === 'academy' && (
            <div className="text-center text-xs text-zinc-400 mt-6 space-y-2">
              <p>Access is by invitation only.</p>
              <button type="button" onClick={() => setShowInviteHelp(v => !v)} className="text-zinc-300 hover:text-white transition-colors underline-offset-2 hover:underline">
                Accepting an invite?
              </button>
              {showInviteHelp && (
                <p className="text-zinc-500">Open the link in your invitation email — it creates your account and puts you in the right class.</p>
              )}
            </div>
          )}
          {!showForgotPw && profile?.frontDoor === 'rental_inventory' && shopOpen && (
            <a
              href="/shop"
              className="mt-6 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-white/10 text-sm text-zinc-200 hover:bg-white/5 transition-colors"
            >
              <Package className="w-4 h-4" /> Browse equipment
            </a>
          )}
          {/* production: staff sign-in only — no secondary action */}
          <LegalFooter />
        </div>
      </motion.div>
    </div>
  )
}
