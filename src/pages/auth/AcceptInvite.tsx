import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Film, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react'
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { createUserWithEmailAndPassword as createUser, updateProfile as updateFbProfile } from 'firebase/auth'
import { auth, db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'

const schema = z.object({
  displayName: z.string().min(2, 'Enter your full name'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

type FormData = z.infer<typeof schema>

interface Invitation {
  email: string
  role: string
  cohortId: string | null
  used: boolean
}

export default function AcceptInvite() {
  const [params]   = useSearchParams()
  const token      = params.get('token') ?? ''
  const navigate   = useNavigate()
  const { refreshToken } = useAuth()

  const [invite,  setInvite]  = useState<Invitation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [showPw,  setShowPw]  = useState(false)
  const [done,    setDone]    = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!token) { setLoading(false); return }
    getDoc(doc(db, 'invitations', token)).then(snap => {
      if (snap.exists()) {
        const data = snap.data() as Invitation
        if (data.used) setError('This invite link has already been used.')
        else setInvite(data)
      } else {
        setError('Invalid or expired invite link.')
      }
      setLoading(false)
    })
  }, [token])

  async function onSubmit(data: FormData) {
    if (!invite) return
    setError('')
    try {
      // Create Firebase Auth account
      const cred = await createUser(auth, invite.email, data.password)
      // Set display name
      await updateFbProfile(cred.user, { displayName: data.displayName })
      // Create Firestore user document (role + cohortId set by onUserCreate Cloud Function)
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid:            cred.user.uid,
        email:          invite.email,
        displayName:    data.displayName,
        role:           invite.role,
        avatarUrl:      null,
        cohortId:       invite.cohortId,
        enrolledAt:     serverTimestamp(),
        totalPoints:    0,
        pointsRedeemed: 0,
        isActive:       true,
      })
      // Mark invite as used
      await updateDoc(doc(db, 'invitations', token), { used: true })
      // Force token refresh so custom claims are live
      await refreshToken()
      setDone(true)
      setTimeout(() => {
        if (invite.role === 'teacher') navigate('/teacher')
        else navigate('/dashboard')
      }, 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="bg-white rounded-3xl shadow-2xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mb-3">
              <Film className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Join CineForge</h1>
            {invite && (
              <p className="text-sm text-slate-500 mt-1">Creating account for <strong>{invite.email}</strong></p>
            )}
          </div>

          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-slate-800">Account created!</p>
              <p className="text-sm text-slate-500 mt-1">Redirecting you now…</p>
            </div>
          ) : error && !invite ? (
            <div className="flex items-center gap-2 p-4 bg-rose-50 border border-rose-100 rounded-xl">
              <AlertCircle className="w-5 h-5 text-rose-500" />
              <p className="text-sm text-rose-600">{error}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="label">Full name</label>
                <input {...register('displayName')} className="input" placeholder="Jane Doe" />
                {errors.displayName && <p className="text-xs text-rose-500 mt-1">{errors.displayName.message}</p>}
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    {...register('password')}
                    type={showPw ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="Min 8 chars, 1 upper, 1 number"
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>}
              </div>

              <div>
                <label className="label">Confirm password</label>
                <input
                  {...register('confirmPassword')}
                  type="password"
                  className="input"
                  placeholder="Repeat password"
                />
                {errors.confirmPassword && <p className="text-xs text-rose-500 mt-1">{errors.confirmPassword.message}</p>}
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-100 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <p className="text-sm text-rose-600">{error}</p>
                </div>
              )}

              <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base mt-2">
                {isSubmitting ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  )
}
