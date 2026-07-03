import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Film, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { httpsCallable } from 'firebase/functions'
import { doc, getDoc } from 'firebase/firestore'
import { functions, db } from '@/lib/firebase'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 32)
}

const schema = z.object({
  schoolName:      z.string().min(2, 'Enter your school name'),
  schoolId:        z.string().regex(/^[a-z0-9-]{2,32}$/, 'Use 2–32 lowercase letters, numbers, or hyphens'),
  adminName:       z.string().min(2, 'Enter your full name'),
  adminEmail:      z.string().email('Enter a valid email'),
  password:        z.string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
  confirmPassword: z.string(),
  gdprConsent:     z.literal(true, { errorMap: () => ({ message: 'You must accept before continuing' }) }),
}).refine(d => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

type FormData = z.infer<typeof schema>

type Availability = 'idle' | 'checking' | 'available' | 'taken'

export default function SchoolSignup() {
  const navigate = useNavigate()
  const [slugReady,     setSlugReady]     = useState(false)
  const [showPw,        setShowPw]        = useState(false)
  const [error,         setError]         = useState('')
  const [done,          setDone]          = useState(false)
  const [slugEdited,    setSlugEdited]    = useState(false)
  const [availability,  setAvailability]  = useState<Availability>('idle')
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slugEditedRef = useRef(false)

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { schoolId: '', gdprConsent: undefined as unknown as true },
  })

  const schoolNameValue = watch('schoolName')
  const schoolIdValue   = watch('schoolId') ?? ''

  // Auto-populate slug from school name unless user has manually edited it
  useEffect(() => {
    if (!slugEditedRef.current) {
      setValue('schoolId', slugify(schoolNameValue ?? ''), { shouldValidate: false })
    }
  }, [schoolNameValue])

  // Debounced availability check
  useEffect(() => {
    if (!slugReady) return
    const slug = schoolIdValue
    if (!slug || !/^[a-z0-9-]{2,32}$/.test(slug)) {
      setAvailability('idle')
      return
    }
    setAvailability('checking')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const snap = await getDoc(doc(db, 'schools', slug))
        setAvailability(snap.exists() ? 'taken' : 'available')
      } catch {
        setAvailability('idle')
      }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [schoolIdValue, slugReady])

  async function onSubmit(data: FormData) {
    if (availability !== 'available') return
    setError('')
    try {
      const provisionSchool = httpsCallable(functions, 'provisionSchool')
      await provisionSchool({
        schoolName:  data.schoolName.trim(),
        schoolId:    data.schoolId,
        adminName:   data.adminName.trim(),
        adminEmail:  data.adminEmail.trim().toLowerCase(),
        password:    data.password,
        gdprConsent: {
          given:     true,
          version:   '1.0',
          method:    'school-signup-form',
          ipHash:    null,
        },
      })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <div className="bg-zinc-900 rounded-3xl shadow-2xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mb-3 shadow-lg shadow-brand-200">
              <Film className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-100">Create your school</h1>
            <p className="text-sm text-zinc-500 mt-1">Get started with CineForge — free during beta</p>
          </div>

          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-zinc-200">School created!</p>
              <p className="text-sm text-zinc-500 mt-1">Redirecting to login…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* School name */}
              <div>
                <label className="label">School name</label>
                <input {...register('schoolName')} className="input" placeholder="Film Academy Stockholm" />
                {errors.schoolName && <p className="text-xs text-rose-500 mt-1">{errors.schoolName.message}</p>}
              </div>

              {/* School ID slug */}
              <div>
                <label className="label">School ID</label>
                <input
                  {...register('schoolId')}
                  autoComplete="off"
                  readOnly={!slugReady}
                  onFocus={() => setSlugReady(true)}
                  className="input font-mono"
                  placeholder="film-academy-stockholm"
                  spellCheck={false}
                  autoCapitalize="none"
                  onChange={e => {
                    slugEditedRef.current = true
                    setSlugEdited(true)
                    setValue('schoolId', e.target.value, { shouldValidate: true })
                  }}
                />
                {/* Availability indicator — always rendered, independent of validation errors */}
                <div className="mt-1 min-h-[1rem] flex items-center gap-1">
                  {availability === 'checking' && (
                    <><Loader2 className="w-3 h-3 text-zinc-400 animate-spin" /><span className="text-xs text-zinc-500">Checking…</span></>
                  )}
                  {availability === 'available' && (
                    <><CheckCircle2 className="w-3 h-3 text-emerald-500" /><span className="text-xs text-emerald-500">Available</span></>
                  )}
                  {availability === 'taken' && (
                    <><AlertCircle className="w-3 h-3 text-rose-500" /><span className="text-xs text-rose-500">Already taken</span></>
                  )}
                </div>
                {errors.schoolId && <p className="text-xs text-rose-500">{errors.schoolId.message}</p>}
                <p className="text-xs text-zinc-600 mt-1">Used in your portal URL. Lowercase letters, numbers, and hyphens only.</p>
              </div>

              {/* Admin full name */}
              <div>
                <label className="label">Your full name</label>
                <input {...register('adminName')} className="input" placeholder="Jane Doe" />
                {errors.adminName && <p className="text-xs text-rose-500 mt-1">{errors.adminName.message}</p>}
              </div>

              {/* Admin email */}
              <div>
                <label className="label">Your email</label>
                <input {...register('adminEmail')} type="email" className="input" placeholder="you@school.com" />
                {errors.adminEmail && <p className="text-xs text-rose-500 mt-1">{errors.adminEmail.message}</p>}
              </div>

              {/* Password */}
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>}
              </div>

              {/* Confirm password */}
              <div>
                <label className="label">Confirm password</label>
                <input {...register('confirmPassword')} type="password" className="input" placeholder="Repeat password" />
                {errors.confirmPassword && <p className="text-xs text-rose-500 mt-1">{errors.confirmPassword.message}</p>}
              </div>

              {/* GDPR consent */}
              <div className="border border-white/10 rounded-xl p-3 space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    {...register('gdprConsent')}
                    className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 accent-brand-500 flex-shrink-0"
                  />
                  <span className="text-xs text-zinc-400 leading-relaxed">
                    I accept that CineForge stores and processes my personal data (name, email, school activity)
                    to run the platform. Data is stored in the EU and never sold. I can request deletion by
                    contacting support.
                  </span>
                </label>
                <a href="/privacy" target="_blank" rel="noopener noreferrer"
                  className="block text-xs text-zinc-600 hover:text-zinc-400 transition-colors pl-7">
                  Read privacy policy
                </a>
                {errors.gdprConsent && <p className="text-xs text-rose-500 pl-7">{errors.gdprConsent.message}</p>}
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-800/50 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <p className="text-sm text-rose-600">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || availability === 'taken' || availability === 'checking'}
                className="btn-primary w-full py-3 text-base mt-2 disabled:opacity-50"
              >
                {isSubmitting ? 'Creating school…' : 'Create school'}
              </button>
            </form>
          )}

          <p className="text-center text-xs text-zinc-500 mt-6">
            Already have an account?{' '}
            <a href="/login" className="text-brand-400 hover:underline">Sign in</a>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
