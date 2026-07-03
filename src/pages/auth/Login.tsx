import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Film, Eye, EyeOff, AlertCircle, ArrowLeft } from 'lucide-react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useSchool } from '@/contexts/SchoolContext'

const schema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type FormData = z.infer<typeof schema>

export default function Login() {
  const { signIn } = useAuth()
  const { shortName } = useSchool()
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
      const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email)))
      if (snap.empty) {
        setResetError('No account found with that email address.')
        return
      }
      if (snap.docs[0].data().disabled === true) {
        setResetError('This account has been deactivated. Contact your teacher.')
        return
      }
      await sendPasswordResetEmail(auth, email)
      setResetMessage('Reset link sent! Check your email inbox.')
    } catch {
      setResetError('Something went wrong. Try again.')
    } finally {
      setResetSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 flex items-center justify-center p-4">
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
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mb-3 shadow-lg shadow-brand-200">
              <Film className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100">{shortName}</h1>
            <p className="text-sm text-zinc-500 mt-1">Filmmaking Education Platform</p>
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
                  autoFocus
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

          <p className="text-center text-xs text-zinc-400 mt-6">
            No account yet? Your teacher will send you an invite link.
          </p>
          <p className="text-center text-xs text-zinc-500 mt-2">
            New school?{' '}
            <a href="/signup" className="text-brand-400 hover:underline">Register here</a>
          </p>
          <p className="text-center text-xs text-zinc-600 mt-3">
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-400 transition-colors">
              Privacy Policy
            </a>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
