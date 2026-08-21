import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Film, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react'
import { doc, getDoc, getDocs, updateDoc, setDoc, deleteDoc, serverTimestamp, collection, query, where, arrayUnion } from 'firebase/firestore'
import { createUserWithEmailAndPassword as createUser, updateProfile as updateFbProfile } from 'firebase/auth'
import { auth, db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useSchool } from '@/contexts/SchoolContext'

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
  displayName: string | null
  used: boolean
  expiresAt?: { toDate: () => Date }
}

export default function AcceptInvite() {
  const [params]   = useSearchParams()
  const token      = params.get('token') ?? ''
  const navigate   = useNavigate()
  const { refreshToken } = useAuth()
  const { shortName } = useSchool()

  const [invite,       setInvite]       = useState<Invitation | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [showPw,       setShowPw]       = useState(false)
  const [done,         setDone]         = useState(false)
  // GDPR step: null = not yet decided, true = accepted, false = declined
  const [gdprAccepted, setGdprAccepted] = useState<boolean | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting }, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!token) { setLoading(false); return }
    getDoc(doc(db, 'invitations', token)).then(snap => {
      if (snap.exists()) {
        const data = snap.data() as Invitation
        if (data.used) {
          setError('This invite link has already been used.')
        } else if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
          setError('This invite link has expired.')
        } else {
          setInvite(data)
          if (data.displayName) setValue('displayName', data.displayName)
        }
      } else {
        setError('Invalid or expired invite link.')
      }
      setLoading(false)
    }).catch(() => {
      setError('Failed to load invite. Check your connection and try again.')
      setLoading(false)
    })
  }, [token])

  async function onSubmit(data: FormData) {
    if (!invite) return
    setError('')
    // Firebase Auth normalizes token.email to lowercase — invitation update rule compares against it
    const normalizedEmail = invite.email.trim().toLowerCase()
    let cred: Awaited<ReturnType<typeof createUser>> | null = null
    let stage = 'init'
    try {
      stage = 'create-auth-account'
      cred = await createUser(auth, normalizedEmail, data.password)
      stage = 'update-auth-profile'
      await updateFbProfile(cred.user, { displayName: data.displayName })

      // Delete any orphan user docs whose uid field matches but doc.id doesn't.
      // Best-effort — new users can't delete other user docs (rule requires admin);
      // orphans are extremely rare and shouldn't block signup.
      try {
        stage = 'orphan-cleanup'
        const orphans = await getDocs(query(collection(db, 'users'),
          where('uid', '==', cred.user.uid)))
        await Promise.all(orphans.docs
          .filter(d => d.id !== cred!.user.uid)
          .map(d => deleteDoc(d.ref).catch(() => {})))
      } catch { /* best-effort */ }

      stage = 'create-user-doc'
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid:                cred.user.uid,
        email:              normalizedEmail,
        displayName:        data.displayName,
        role:               invite.role,
        roles:              [invite.role],
        avatarUrl:          null,
        cohortId:           invite.cohortId,
        enrolledAt:         serverTimestamp(),
        totalPoints:        0,
        pointsRedeemed:     0,
        isActive:           true,
        privacyAcceptedAt:  serverTimestamp(),
        gdprConsent: {
          given:     true,
          timestamp: serverTimestamp(),
          version:   '1.0',
          method:    'invite-acceptance-explicit',
          ipHash:    null,
        },
      })

      stage = 'mark-invite-used'
      await updateDoc(doc(db, 'invitations', token), { used: true })

      // For teacher invites with a cohort, add them to the cohort's teacherIds.
      // Best-effort — a fresh teacher account has no admin/teacher claim yet, so the
      // cohorts write rule may reject it. The onUserCreate Cloud Function reconciles later.
      if (invite.role === 'teacher' && invite.cohortId) {
        try {
          stage = 'add-teacher-to-cohort'
          await updateDoc(doc(db, 'cohorts', invite.cohortId), {
            teacherIds: arrayUnion(cred.user.uid),
          })
        } catch (err) {
          console.warn('add-teacher-to-cohort failed (will retry via Cloud Function):', err)
        }
      }

      // Poll for role claims — Cloud Function sets them asynchronously
      stage = 'poll-claims'
      await refreshToken()
      for (let i = 0; i < 5; i++) {
        const t = await cred.user.getIdTokenResult(false)
        if (t.claims.role) break
        await new Promise(r => setTimeout(r, 1200))
        await refreshToken()
      }
      setDone(true)
      setTimeout(() => {
        if (invite.role === 'admin')        navigate('/admin/users')
        else if (invite.role === 'teacher') navigate('/teacher')
        else                                navigate('/dashboard')
      }, 1500)
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e)
      const code = (e as { code?: string })?.code
      console.error(`AcceptInvite failed at stage=${stage}`, { code, raw, error: e })
      // If Auth account was created but Firestore setup failed, delete the orphaned Auth account
      // so the user can retry with the same email rather than being permanently locked out.
      if (cred) {
        try { await cred.user.delete() } catch { /* best-effort cleanup */ }
      }
      setError(`Signup failed at "${stage}": ${raw}`)
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 overflow-y-auto flex items-start sm:items-center justify-center px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="bg-zinc-900 rounded-3xl shadow-2xl p-6 sm:p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mb-3">
              <Film className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100">Join {shortName}</h1>
            {invite && (
              <p className="text-sm text-zinc-500 mt-1">Creating account for <strong>{invite.email}</strong></p>
            )}
          </div>

          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-zinc-200">Account created!</p>
              <p className="text-sm text-zinc-500 mt-1">Redirecting you now…</p>
            </div>
          ) : error && !invite ? (
            <div className="flex items-center gap-2 p-4 bg-rose-950/40 border border-rose-800/50 rounded-xl">
              <AlertCircle className="w-5 h-5 text-rose-500" />
              <p className="text-sm text-rose-600">{error}</p>
            </div>
          ) : gdprAccepted === false ? (
            /* ── GDPR declined ── */
            <div className="text-center space-y-4 py-2">
              <div className="w-12 h-12 bg-rose-950/50 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <p className="font-semibold text-zinc-200">Privacy policy declined</p>
                <p className="text-sm text-zinc-500 mt-1">
                  You cannot create an account without accepting the privacy policy.
                  Contact your teacher if you have questions.
                </p>
              </div>
              <button
                onClick={() => setGdprAccepted(null)}
                className="text-sm text-brand-400 hover:text-brand-300 underline"
              >
                Go back
              </button>
            </div>
          ) : gdprAccepted === null ? (
            /* ── GDPR consent step ── */
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-100">Privacy &amp; data consent</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Please read before creating your account</p>
              </div>

              <div className="bg-zinc-800/60 rounded-xl p-4 space-y-3 text-xs text-zinc-400 leading-relaxed max-h-56 overflow-y-auto">
                <div>
                  <p className="font-semibold text-zinc-300 mb-1">What data we collect</p>
                  <p>Name, email address, profile photo, attendance records, assignment results, points, and messages sent within the platform.</p>
                </div>
                <div>
                  <p className="font-semibold text-zinc-300 mb-1">How it is used</p>
                  <p>Your data is used solely to run the educational platform — tracking progress, scheduling, and communication between students and teachers.</p>
                </div>
                <div>
                  <p className="font-semibold text-zinc-300 mb-1">Who can see it</p>
                  <p>Your teachers and school administrators. Your data is never shared with third parties or used for advertising.</p>
                </div>
                <div>
                  <p className="font-semibold text-zinc-300 mb-1">How long it is kept</p>
                  <p>All personal data — including your profile, attendance, grades, development plans, and chat messages — is deleted <strong className="text-zinc-200">1 year after your course ends</strong>. Deletion logs are kept for 5 years as required by law.</p>
                </div>
                <div>
                  <p className="font-semibold text-zinc-300 mb-1">Your rights (GDPR)</p>
                  <p>You have the right to access, correct, and request deletion of your personal data at any time. Contact your school administrator to exercise these rights.</p>
                </div>
              </div>

              <p className="text-xs text-zinc-500">
                Full details in our{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
                  Privacy Policy
                </a>.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setGdprAccepted(false)}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-sm font-medium transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={() => setGdprAccepted(true)}
                  className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors"
                >
                  Accept &amp; continue
                </button>
              </div>
            </div>
          ) : (
            /* ── Account creation form (after GDPR accepted) ── */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="label">Full name</label>
                <input {...register('displayName')} className="input" placeholder="Jane Doe" autoComplete="name" style={{ fontSize: 16 }} />
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
                    autoComplete="new-password"
                    style={{ fontSize: 16 }}
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
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
                  autoComplete="new-password"
                  style={{ fontSize: 16 }}
                />
                {errors.confirmPassword && <p className="text-xs text-rose-500 mt-1">{errors.confirmPassword.message}</p>}
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-800/50 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <p className="text-sm text-rose-600">{error}</p>
                </div>
              )}

              <p className="text-xs text-zinc-500">
                ✓ Privacy policy accepted.{' '}
                <button type="button" onClick={() => setGdprAccepted(null)} className="text-brand-400 hover:underline">Review again</button>
              </p>

              <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base mt-2 disabled:opacity-50">
                {isSubmitting ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  )
}
