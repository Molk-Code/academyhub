import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc, collectionGroup, query, where, getDocs, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage, functions } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { cn, initials, avatarColor, toDate } from '@/lib/utils'
import { Camera, Loader2, CheckCircle2, Star, CalendarCheck, ClipboardList, ChevronRight, Download, Trash2, Shield } from 'lucide-react'
import { useCollection, where as fsWhere, orderBy } from '@/hooks/useFirestore'
import type { PointsLogDoc, AbsenceReportDoc, LessonDoc } from '@/types'

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000]

function getLevel(points: number) {
  let level = 1
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) level = i + 1
    else break
  }
  return level
}

function getLevelProgress(points: number) {
  const level = getLevel(points)
  const current = LEVEL_THRESHOLDS[level - 1] ?? 0
  const next = LEVEL_THRESHOLDS[level] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]
  if (next === current) return 100
  return Math.min(100, Math.round(((points - current) / (next - current)) * 100))
}

const REASON_LABELS: Record<string, string> = {
  test_pass: 'Test passed',
  assignment_graded: 'Assignment graded',
  redemption: 'Prize redeemed',
  bonus: 'Bonus points',
  attendance: 'Attendance',
  absence_penalty: 'Absence penalty',
  redemption_refund: 'Prize refund',
}

function PointsHistorySection({ uid }: { uid: string }) {
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 8
  const { data: log } = useCollection<PointsLogDoc>(
    'points_log',
    [fsWhere('studentId', '==', uid), orderBy('createdAt', 'desc')],
  )
  const totalPages = Math.ceil(log.length / PAGE_SIZE)
  const visible = log.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (!log.length) return <p className="text-sm text-zinc-400">No points history yet.</p>

  return (
    <div className="space-y-2">
      {visible.map(entry => {
        const date = toDate(entry.createdAt)
        const isPositive = entry.points >= 0
        return (
          <div key={entry.id} className="flex items-center justify-between py-2 border-b border-white/8 last:border-0">
            <div>
              <p className="text-sm font-medium text-zinc-300">{REASON_LABELS[entry.reason] ?? entry.reason}</p>
              {date && <p className="text-xs text-zinc-400">{date.toLocaleDateString('sv-SE')}</p>}
            </div>
            <span className={cn('text-sm font-bold', isPositive ? 'text-emerald-600' : 'text-rose-600')}>
              {isPositive ? '+' : ''}{entry.points}
            </span>
          </div>
        )
      })}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="text-xs text-brand-600 disabled:opacity-30 font-medium"
          >
            ← Prev
          </button>
          <span className="text-xs text-zinc-400">{page + 1} / {totalPages}</span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="text-xs text-brand-600 disabled:opacity-30 font-medium"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

function AttendanceSection({ uid, cohortId }: { uid: string; cohortId: string | null }) {
  const { data: absences } = useCollection<AbsenceReportDoc>(
    'absence_reports',
    [fsWhere('studentId', '==', uid)],
  )
  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    cohortId ? [fsWhere('cohortId', '==', cohortId)] : [],
    !!cohortId,
  )

  const now = new Date()
  const pastLessons = lessons.filter(l => {
    const d = toDate(l.startTime)
    return d && d < now
  })
  const absenceCount = absences.length
  const attended = Math.max(0, pastLessons.length - absenceCount)
  const rate = pastLessons.length > 0 ? Math.round((attended / pastLessons.length) * 100) : null

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-zinc-900/50 rounded-xl p-3 text-center">
        <p className="text-xl font-bold text-zinc-200">{rate !== null ? `${rate}%` : '—'}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Rate</p>
      </div>
      <div className="bg-emerald-950/40 rounded-xl p-3 text-center">
        <p className="text-xl font-bold text-emerald-700">{attended}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Attended</p>
      </div>
      <div className="bg-rose-950/40 rounded-xl p-3 text-center">
        <p className="text-xl font-bold text-rose-700">{absenceCount}</p>
        <p className="text-xs text-zinc-500 mt-0.5">Absences</p>
      </div>
    </div>
  )
}

export default function Profile() {
  const { profile, refreshProfile } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isStudent = profile?.role === 'student'
  const isTeacherOrAdmin = profile?.role === 'teacher' || profile?.role === 'admin'

  const [name,       setName]       = useState(profile?.displayName ?? '')
  const [phone,      setPhone]      = useState(profile?.phoneNumber ?? '')
  const [schoolEmail, setSchoolEmail] = useState(profile?.schoolEmail ?? '')
  const [bio,        setBio]        = useState((profile as any)?.bio ?? '')
  const [portfolio,  setPortfolio]  = useState((profile as any)?.portfolioUrl ?? '')
  const [uploading,  setUploading]  = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.avatarUrl ?? null)

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile) return
    setAvatarPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      const path    = `avatars/${profile.uid}`
      const fileRef = storageRef(storage, path)
      await uploadBytes(fileRef, file)
      const url = await getDownloadURL(fileRef)
      await updateDoc(doc(db, 'users', profile.uid), { avatarUrl: url })
      setAvatarPreview(url)
      await refreshProfile()
    } catch (err) {
      console.error('Upload failed', err)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave() {
    if (!profile || !name.trim()) return
    setSaving(true)
    setSaved(false)
    try {
      const update: Record<string, string> = {
        displayName: name.trim(),
        phoneNumber: phone.trim(),
        schoolEmail: schoolEmail.trim(),
      }
      if (isTeacherOrAdmin) {
        update.bio = bio.trim()
        update.portfolioUrl = portfolio.trim()
      }
      await updateDoc(doc(db, 'users', profile.uid), update)

      if (isTeacherOrAdmin) {
        const snap = await getDocs(
          query(collectionGroup(db, 'teachers'), where('userId', '==', profile.uid)),
        )
        if (!snap.empty) {
          const batch = writeBatch(db)
          snap.docs.forEach(d => batch.update(d.ref, {
            description:  bio.trim(),
            portfolioUrl: portfolio.trim() || null,
          }))
          await batch.commit()
        }
      }

      await refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      console.error('Save failed', err)
    } finally {
      setSaving(false)
    }
  }

  if (!profile) return null

  const totalPoints = profile.totalPoints ?? 0
  const available   = totalPoints - (profile.pointsRedeemed ?? 0)
  const level       = getLevel(totalPoints)
  const levelPct    = getLevelProgress(totalPoints)
  const nextThreshold = LEVEL_THRESHOLDS[level] ?? null

  return (
    <div className="max-w-lg space-y-8">

      {/* ── Header ── */}
      <div className="flex items-center gap-5">
        <div className="relative group">
          {avatarPreview ? (
            <img src={avatarPreview} alt={profile.displayName} className="w-20 h-20 rounded-full object-cover ring-4 ring-white shadow-md" />
          ) : (
            <div className={cn('w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold ring-4 ring-white shadow-md', avatarColor(profile.uid))}>
              {initials(profile.displayName)}
            </div>
          )}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            {uploading ? <Loader2 className="w-6 h-6 text-white animate-spin" /> : <Camera className="w-6 h-6 text-white" />}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-zinc-200">{profile.displayName}</h1>
          <span className="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 capitalize">{profile.role}</span>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="block text-sm text-brand-600 hover:text-brand-700 font-medium mt-1.5 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Change photo'}
          </button>
        </div>
      </div>

      {/* ── Points & Level (students only) ── */}
      {isStudent && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-zinc-200">Points & Level</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-amber-950/40 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-amber-600">{available}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Available</p>
            </div>
            <div className="bg-zinc-900/50 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-zinc-300">{totalPoints}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Total earned</p>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-brand-700">Level {level}</span>
              {nextThreshold && (
                <span className="text-xs text-zinc-400">{totalPoints} / {nextThreshold} pts</span>
              )}
            </div>
            <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded-full transition-all duration-500"
                style={{ width: `${levelPct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Attendance (students only) ── */}
      {isStudent && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-emerald-500" />
            <h2 className="font-semibold text-zinc-200">Attendance</h2>
          </div>
          <AttendanceSection uid={profile.uid} cohortId={profile.cohortId ?? null} />
        </div>
      )}

      {/* ── Quick Links (students only) ── */}
      {isStudent && (
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/my-plan"
            className="card flex items-center justify-between gap-3 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">📋</span>
              <span className="text-sm font-semibold text-zinc-300">My Plan</span>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          </Link>
          <Link
            to="/tasks"
            className="card flex items-center justify-between gap-3 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">✅</span>
              <span className="text-sm font-semibold text-zinc-300">My Tasks</span>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          </Link>
        </div>
      )}

      {/* ── Edit profile fields ── */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-zinc-200">Edit Profile</h2>
        <div>
          <label className="label">Display name</label>
          <input value={name} onChange={e => { setName(e.target.value); setSaved(false) }} className="input" placeholder="Your full name" />
        </div>
        <div>
          <label className="label">Email</label>
          <input value={profile.email} disabled className="input bg-zinc-900/50 text-zinc-400 cursor-not-allowed" />
          <p className="text-xs text-zinc-400 mt-1">Email cannot be changed here.</p>
        </div>
        <div>
          <label className="label">Phone number</label>
          <input type="tel" value={phone} onChange={e => { setPhone(e.target.value); setSaved(false) }} className="input" placeholder="+46 70 000 00 00" />
        </div>
        <div>
          <label className="label">School email</label>
          <input type="email" value={schoolEmail} onChange={e => { setSchoolEmail(e.target.value); setSaved(false) }} className="input" placeholder="firstname.lastname@school.se" />
        </div>
        {isTeacherOrAdmin && (
          <>
            <div>
              <label className="label">Bio / Description</label>
              <textarea rows={3} value={bio} onChange={e => { setBio(e.target.value); setSaved(false) }} className="input resize-none" placeholder="Short background or description shown on subject pages…" />
            </div>
            <div>
              <label className="label">Portfolio link <span className="text-zinc-400 font-normal">(optional)</span></label>
              <input value={portfolio} onChange={e => { setPortfolio(e.target.value); setSaved(false) }} className="input" placeholder="https://your-portfolio.com" />
            </div>
          </>
        )}
        <div className="flex items-center gap-3 pt-1">
          <button type="button" disabled={saving || !name.trim()} onClick={handleSave} className="btn-primary py-2.5 px-6 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
        </div>
      </div>

      {/* ── Calendar colour ── */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-zinc-200">My Calendar Colour</h2>
        <p className="text-sm text-zinc-400">Choose the colour used for your personal calendar events.</p>
        <div className="flex flex-wrap gap-2">
          {['#f26419','#f6ae2d','#10b981','#33658a','#86bbd8','#8b5cf6','#f43f5e','#0ea5e9','#14b8a6','#e879f9'].map(hex => (
            <button
              key={hex}
              type="button"
              onClick={async () => {
                if (!profile) return
                await updateDoc(doc(db, 'users', profile.uid), { calendarColor: hex })
                await refreshProfile()
              }}
              className="w-8 h-8 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
              style={{ backgroundColor: hex }}
            >
              {((profile as any)?.calendarColor ?? '#86bbd8') === hex && (
                <CheckCircle2 className="w-4 h-4 text-white drop-shadow" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Points history (students only) ── */}
      {isStudent && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-brand-500" />
            <h2 className="font-semibold text-zinc-200">Points History</h2>
          </div>
          <PointsHistorySection uid={profile.uid} />
        </div>
      )}

      {/* ── GDPR / Data rights ── */}
      <GdprSection uid={profile.uid} displayName={profile.displayName} />

    </div>
  )
}

function GdprSection({ uid, displayName }: { uid: string; displayName: string }) {
  const [exporting, setExporting] = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { signOut } = useAuth()

  async function handleExport() {
    setExporting(true)
    try {
      const exportUserData = httpsCallable(functions, 'exportUserData')
      const result = await exportUserData({ userId: uid })
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cineforge-data-${displayName.replace(/\s+/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert('Export failed: ' + (err?.message ?? 'Unknown error'))
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const deleteUserData = httpsCallable(functions, 'deleteUserData')
      await deleteUserData({ userId: uid })
      await signOut()
    } catch (err: any) {
      alert('Deletion failed: ' + (err?.message ?? 'Unknown error'))
      setDeleting(false)
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-brand-400" />
        <h2 className="font-semibold text-zinc-200">My Data &amp; Privacy</h2>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">
        Under GDPR you have the right to access and delete your personal data.{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
          Read our Privacy Policy
        </a>
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center justify-center gap-2 btn-secondary py-2 px-4 text-sm disabled:opacity-40"
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting…' : 'Download My Data'}
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium rounded-xl bg-rose-900/30 border border-rose-800/40 text-rose-400 hover:bg-rose-900/50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete My Account
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 py-2 px-3 text-sm btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 py-2 px-3 text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-xl disabled:opacity-40 transition-colors"
            >
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
