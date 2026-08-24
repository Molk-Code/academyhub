import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc, collectionGroup, query, where, getDocs, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions, auth } from '@/lib/firebase'
import { updateEmail } from 'firebase/auth'
import { uploadWithQuota } from '@/lib/uploadWithQuota'
import { useAuth } from '@/contexts/AuthContext'
import { cn, initials, avatarColor, toDate } from '@/lib/utils'
import { Camera, Loader2, CheckCircle2, Star, CalendarCheck, ClipboardList, ChevronRight, Download, Trash2, Shield, TrendingUp, Lightbulb, Image } from 'lucide-react'
import { useCollection, useDocument, where as fsWhere, orderBy } from '@/hooks/useFirestore'
import type { PointsLogDoc, AbsenceReportDoc, CohortDoc, TeacherAssessment } from '@/types'
import { format } from 'date-fns'
import { useAttendanceStats } from '@/hooks/useAttendanceStats'
import { QRCodeCanvas } from 'qrcode.react'
import { jsPDF } from 'jspdf'

function getLevel(points: number) {
  return Math.floor(points / 100) + 1
}

function getLevelProgress(points: number) {
  return points % 100
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

const REASON_ICONS: Record<string, string> = {
  attendance: '⭐',
  assignment_graded: '📝',
  test_pass: '🏆',
  bonus: '🎁',
  redemption: '🛒',
  redemption_refund: '↩️',
  absence_penalty: '❌',
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
        const icon = REASON_ICONS[entry.reason] ?? '•'
        const relativeDate = date
          ? (() => {
              const diff = Math.floor((Date.now() - date.getTime()) / 86400000)
              if (diff === 0) return 'Today'
              if (diff === 1) return 'Yesterday'
              if (diff < 7) return `${diff}d ago`
              if (diff < 30) return `${Math.floor(diff / 7)}w ago`
              return date.toLocaleDateString('sv-SE')
            })()
          : ''
        return (
          <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-white/8 last:border-0">
            <span className="text-lg flex-shrink-0 w-7 text-center">{icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-300">{REASON_LABELS[entry.reason] ?? entry.reason}</p>
              <p className="text-xs text-zinc-500">{relativeDate}</p>
            </div>
            <span className={cn('text-sm font-bold flex-shrink-0', isPositive ? 'text-orange-400' : 'text-rose-500')}>
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


function AttendanceSection({ uid, cohortId, enrolledAt }: { uid: string; cohortId: string | null; enrolledAt?: { toDate(): Date } | null }) {
  const stats = useAttendanceStats(uid, cohortId, enrolledAt)
  const { data: absenceReports } = useCollection<AbsenceReportDoc>(
    'absence_reports',
    uid ? [fsWhere('studentId', '==', uid)] : [],
    !!uid,
  )

  const attended = stats?.attended ?? 0
  const absent   = stats?.absent ?? 0
  const rate     = stats !== null ? stats.attendancePct : null

  // Build lookup sets from absence reports for fast "excused" detection
  const excusedLessonIds  = new Set(absenceReports.map(r => r.lessonId).filter(Boolean) as string[])
  const excusedDates      = new Set(absenceReports.map(r => r.date))

  // Reverse-chronological, last 20 past lessons
  const historyRows = [...(stats?.lessons ?? [])].reverse().slice(0, 20)

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {[
          { value: rate !== null ? `${rate}%` : '—', label: 'Rate',     cls: 'bg-zinc-900/50 text-zinc-200'    },
          { value: attended,                          label: 'Attended', cls: 'bg-emerald-950/40 text-emerald-700' },
          { value: absent,                            label: 'Absences', cls: 'bg-rose-950/40 text-rose-700'    },
        ].map(({ value, label, cls }) => (
          <div key={label} className={cn('rounded-xl p-3 text-center', cls.split(' ')[0])}>
            <p className={cn('text-xl font-bold', cls.split(' ')[1])}>{value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {historyRows.length > 0 && (
        <div className="mt-2">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Attendance History</h3>
          <div className="space-y-0">
            {historyRows.map(lesson => {
              const isExcused = !lesson.attended && (excusedLessonIds.has(lesson.id) || excusedDates.has(lesson.date))
              const state = lesson.attended ? 'present' : isExcused ? 'excused' : 'absent'
              const styles = {
                present: { dot: 'bg-emerald-500/20 text-emerald-400', badge: 'bg-emerald-900/40 text-emerald-400', symbol: '✓', label: 'Present' },
                excused: { dot: 'bg-amber-500/20 text-amber-400',   badge: 'bg-amber-900/40 text-amber-400',   symbol: '~', label: 'Excused' },
                absent:  { dot: 'bg-red-500/20 text-red-400',       badge: 'bg-red-900/40 text-red-400',       symbol: '✗', label: 'Absent'  },
              }[state]
              return (
                <div key={lesson.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${styles.dot}`}>
                    {styles.symbol}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{lesson.title}</p>
                    <p className="text-xs text-zinc-500">
                      {lesson.date}
                      {lesson.startTime && (
                        <span className="ml-1.5 font-mono">
                          {lesson.startTime}{lesson.endTime ? `–${lesson.endTime}` : ''}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${styles.badge}`}>
                    {styles.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

export default function Profile() {
  const { profile, refreshProfile } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const qrCanvasRef  = useRef<HTMLCanvasElement>(null)

  const isStudent = profile?.role === 'student'
  const isTeacherOrAdmin = profile?.role === 'teacher' || profile?.role === 'admin'

  const appUrl = window.location.origin

  function downloadQRImage() {
    const canvas = qrCanvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'cineforge-qr.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  function downloadQRPdf() {
    const canvas = qrCanvasRef.current
    if (!canvas) return
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pw = pdf.internal.pageSize.getWidth()
    const size = 80
    const x = (pw - size) / 2
    pdf.setFontSize(18)
    pdf.setFont('helvetica', 'bold')
    pdf.text('CineForge', pw / 2, 30, { align: 'center' })
    pdf.setFontSize(11)
    pdf.setFont('helvetica', 'normal')
    pdf.text('Scan to access the platform', pw / 2, 38, { align: 'center' })
    pdf.addImage(imgData, 'PNG', x, 48, size, size)
    pdf.setFontSize(9)
    pdf.text(appUrl, pw / 2, 48 + size + 8, { align: 'center' })
    pdf.save('cineforge-qr.pdf')
  }

  const { data: cohort }      = useDocument<CohortDoc>('cohorts', profile?.cohortId ?? '')
  const { data: assessment }  = useDocument<TeacherAssessment>('teacher_assessments', isStudent ? (profile?.uid ?? '') : '')

  const [name,       setName]       = useState(profile?.displayName ?? '')
  const [phone,      setPhone]      = useState(profile?.phoneNumber ?? '')
  const [email,      setEmail]      = useState(profile?.email ?? '')
  const [bio,        setBio]        = useState((profile as any)?.bio ?? '')
  const [portfolio,  setPortfolio]  = useState((profile as any)?.portfolioUrl ?? '')
  const [uploading,    setUploading]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [uploadError,  setUploadError]  = useState<string | null>(null)
  const [emailError,   setEmailError]   = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.avatarUrl ?? null)

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile) return
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image is too large. Maximum size is 5 MB.')
      e.target.value = ''
      return
    }
    const previewUrl = URL.createObjectURL(file)
    setAvatarPreview(previewUrl)
    setUploading(true)
    setUploadError(null)
    try {
      const path = `avatars/${profile.uid}`
      const url  = await uploadWithQuota(file, path)
      await updateDoc(doc(db, 'users', profile.uid), { avatarUrl: url })
      setAvatarPreview(url)
      // Sync avatar to any subject teacher entries for this user
      const snap = await getDocs(query(collectionGroup(db, 'teachers'), where('userId', '==', profile.uid)))
      if (!snap.empty) {
        const batch = writeBatch(db)
        snap.docs.forEach(d => batch.update(d.ref, { imageUrl: url }))
        await batch.commit()
      }
      await refreshProfile()
    } catch (err: any) {
      console.error('Upload failed', err)
      setUploadError(err?.message ?? 'Upload failed. Please try again.')
      setAvatarPreview(profile.avatarUrl ?? null)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSave() {
    if (!profile || !name.trim()) return
    setSaving(true)
    setSaved(false)
    setEmailError(null)
    try {
      const newEmail = email.trim()
      if (newEmail && newEmail !== profile.email) {
        if (!auth.currentUser) throw new Error('Not authenticated')
        try {
          await updateEmail(auth.currentUser, newEmail)
        } catch (err: any) {
          if (err?.code === 'auth/requires-recent-login') {
            setEmailError('Please sign out and sign back in before changing your email.')
          } else {
            setEmailError(err?.message ?? 'Failed to update email.')
          }
          return
        }
      }
      const update: Record<string, string> = {
        displayName: name.trim(),
        phoneNumber: phone.trim(),
        email: newEmail || profile.email,
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
            name:         name.trim(),
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
  const pointsToNext = 100 - (totalPoints % 100)

  return (
    <div className="max-w-lg space-y-8">

      {/* ── Header ── */}
      <div className="flex items-center gap-5">
        <div className="relative group flex-shrink-0">
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

        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-zinc-100">{profile.displayName}</h1>
          {uploadError && (
            <p className="text-xs text-rose-400 mt-1">{uploadError}</p>
          )}
          {isStudent && cohort ? (
            <p className="text-sm text-zinc-500 mt-0.5">{cohort.name} · Year {cohort.programYear}</p>
          ) : (
            <span className="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 capitalize">{profile.role}</span>
          )}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="block text-sm text-brand-600 hover:text-brand-700 font-medium mt-1.5 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Change photo'}
          </button>
        </div>

        {/* ── App QR code ── */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
          {/* Hidden canvas used for downloads */}
          <QRCodeCanvas ref={qrCanvasRef} value={appUrl} size={200} className="hidden" />
          {/* Visible QR */}
          <div className="bg-white p-1.5 rounded-xl shadow">
            <QRCodeCanvas value={appUrl} size={72} />
          </div>
          {isTeacherOrAdmin && (
            <div className="flex gap-1">
              <button
                onClick={downloadQRImage}
                title="Download as image"
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-1.5 py-0.5 rounded hover:bg-white/5"
              >
                <Image className="w-3 h-3" /> PNG
              </button>
              <button
                onClick={downloadQRPdf}
                title="Download as PDF"
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-1.5 py-0.5 rounded hover:bg-white/5"
              >
                <Download className="w-3 h-3" /> PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Points & Level (students only) ── */}
      {isStudent && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-zinc-200">Points & Level</h2>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <p className="text-5xl font-extrabold text-orange-400 leading-none">{totalPoints}</p>
              <p className="text-xs text-zinc-500 mt-1">Total points</p>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-zinc-200">Level {level}</span>
                <span className="text-xs text-zinc-500">{pointsToNext} pts to Level {level + 1}</span>
              </div>
              <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-orange-400 rounded-full transition-all duration-500"
                  style={{ width: `${levelPct}%` }}
                />
              </div>
            </div>
          </div>
          {available !== totalPoints && (
            <div className="flex items-center justify-between text-sm text-zinc-400 pt-1">
              <span>Available to spend</span>
              <span className="font-semibold text-amber-400">{available} pts</span>
            </div>
          )}
        </div>
      )}

      {/* ── Attendance (students only) ── */}
      {isStudent && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-emerald-500" />
            <h2 className="font-semibold text-zinc-200">Attendance</h2>
          </div>
          <AttendanceSection uid={profile.uid} cohortId={profile.cohortId ?? null} enrolledAt={profile.enrolledAt} />
        </div>
      )}

      {/* ── Quick Links (students only) ── */}
      {isStudent && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { to: '/my-plan',     icon: '📋', label: 'My Plan'     },
            { to: '/prizes',      icon: '🏆', label: 'Prizes'      },
            { to: '/assignments', icon: '📝', label: 'Assignments' },
          ].map(({ to, icon, label }) => (
            <Link
              key={to}
              to={to}
              className="card flex flex-col items-center gap-2 py-4 hover:shadow-md transition-shadow text-center"
            >
              <span className="text-2xl">{icon}</span>
              <span className="text-xs font-semibold text-zinc-300">{label}</span>
            </Link>
          ))}
        </div>
      )}

      {/* ── Teacher Assessment (students only) ── */}
      {isStudent && (assessment?.strengths || assessment?.developments) && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-zinc-200">Teacher Assessment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {assessment.strengths && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> Strengths
                </p>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-800/50 rounded-xl p-4 leading-relaxed">
                  {assessment.strengths}
                </p>
              </div>
            )}
            {assessment.developments && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" /> Areas for Development
                </p>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-800/50 rounded-xl p-4 leading-relaxed">
                  {assessment.developments}
                </p>
              </div>
            )}
          </div>
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
          <input type="email" value={email} onChange={e => { setEmail(e.target.value); setSaved(false); setEmailError(null) }} className="input" placeholder="your@email.com" />
          {emailError && <p className="text-xs text-red-400 mt-1">{emailError}</p>}
        </div>
        <div>
          <label className="label">Phone number</label>
          <input type="tel" value={phone} onChange={e => { setPhone(e.target.value); setSaved(false) }} className="input" placeholder="+46 70 000 00 00" />
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
