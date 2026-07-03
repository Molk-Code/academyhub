import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import { collection, query, where, getDocs, getDoc, doc, setDoc, addDoc, updateDoc, increment, serverTimestamp, deleteDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where as collectionWhere, orderBy } from '@/hooks/useFirestore'
import type { LessonDoc, AbsenceReportDoc, CohortDoc, PointsLogDoc } from '@/types'
import { CheckCircle2, AlertCircle, AlertTriangle, Trash2, Check, TrendingUp, Star, QrCode } from 'lucide-react'
import { format, isAfter, isBefore, startOfDay } from 'date-fns'
import { useAttendanceStats } from '@/hooks/useAttendanceStats'

type Phase = 'idle' | 'loading' | 'success' | 'error'

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd')
}

export default function CheckIn() {
  const { profile, cohortId, previewCohortId } = useAuth()
  const effectiveCohortId = previewCohortId ?? cohortId

  const [phase,         setPhase]         = useState<Phase>('idle')
  const [scannerActive, setScannerActive] = useState(false)
  const [message,       setMessage]       = useState('')
  const profileRef = useRef(profile)

  // Absence reporting state
  const [absenceDate, setAbsenceDate] = useState(todayStr())
  const [absenceType, setAbsenceType] = useState<'full_day' | 'lesson'>('full_day')
  const [absenceLessonId, setAbsenceLessonId] = useState('')
  const [absenceReason, setAbsenceReason] = useState('')
  const [absenceSubmitting, setAbsenceSubmitting] = useState(false)
  const [absenceSuccess, setAbsenceSuccess] = useState(false)

  const { data: myReports } = useCollection<AbsenceReportDoc>(
    'absence_reports',
    profile ? [collectionWhere('studentId', '==', profile.uid), orderBy('reportedAt', 'desc')] : [],
    !!profile,
    profile?.uid ?? '',
  )

  // Lessons on the selected absence date (for specific lesson mode)
  const { data: allLessons } = useCollection<LessonDoc>(
    'lessons',
    effectiveCohortId ? [collectionWhere('cohortId', '==', effectiveCohortId)] : [],
    !!effectiveCohortId,
    effectiveCohortId ?? '',
  )

  // Cohort data for year start / end (absence rate calculation)
  const { data: cohorts } = useCollection<CohortDoc>('cohorts')
  const myCohort = useMemo(
    () => cohorts.find(c => c.id === effectiveCohortId) ?? null,
    [cohorts, effectiveCohortId],
  )

  const absenceStats = useAttendanceStats(profile?.uid ?? null, effectiveCohortId ?? null)

  const lessonsOnDate = useMemo(() => {
    return allLessons.filter(l => {
      const d = l.startTime?.toDate?.()
      if (!d) return false
      return format(d, 'yyyy-MM-dd') === absenceDate
    }).sort((a, b) => (a.startTime?.toMillis?.() ?? 0) - (b.startTime?.toMillis?.() ?? 0))
  }, [allLessons, absenceDate])

  useEffect(() => { profileRef.current = profile }, [profile])

  const handleCheckIn = useCallback(async (token: string) => {
    setPhase('loading')
    try {
      const uid = profileRef.current?.uid
      if (!uid) throw new Error('Not logged in')

      // 1. Find active session
      const sessionQuery = query(
        collection(db, 'attendance_sessions'),
        where('token', '==', token),
        where('isActive', '==', true)
      )
      const sessionSnap = await getDocs(sessionQuery)
      if (sessionSnap.empty) throw new Error('Invalid QR code. Ask your teacher to refresh it.')

      const sessionDoc = sessionSnap.docs[0]
      const session = sessionDoc.data()

      // 2. Check expiry
      if (session.expiresAt.toMillis() < Date.now()) {
        throw new Error('QR code expired. Ask your teacher to refresh it.')
      }

      const lessonId = session.lessonId as string

      // 3. Check duplicate
      const attendanceRef = doc(db, 'lessons', lessonId, 'attendance', uid)
      const existing = await getDoc(attendanceRef)
      if (existing.exists()) throw new Error('You have already checked in to this lesson.')

      // 4. Get points setting
      const settingsSnap = await getDoc(doc(db, 'settings', 'attendance'))
      const pointsPerCheckIn: number = settingsSnap.exists()
        ? (settingsSnap.data()?.pointsPerCheckIn ?? 5)
        : 5

      // 5. Record attendance
      await setDoc(attendanceRef, {
        studentId:     uid,
        displayName:   profileRef.current?.displayName ?? 'Student',
        checkedInAt:   serverTimestamp(),
        sessionId:     sessionDoc.id,
        pointsAwarded: pointsPerCheckIn,
      })

      // 6. Award points + log
      if (pointsPerCheckIn > 0) {
        await Promise.all([
          updateDoc(doc(db, 'users', uid), {
            totalPoints: increment(pointsPerCheckIn),
          }),
          addDoc(collection(db, 'points_log'), {
            studentId:   uid,
            points:      pointsPerCheckIn,
            reason:      'attendance',
            referenceId: lessonId,
            awardedBy:   null,
            createdAt:   serverTimestamp(),
          }),
        ])
      }

      setScannerActive(false)
      setPhase('success')
      setMessage(`You're checked in! +${pointsPerCheckIn} pts ⭐`)

    } catch (err: any) {
      setScannerActive(false)
      setPhase('error')
      setMessage(err?.message ?? 'Check-in failed. Try again.')
    }
  }, [])

  useEffect(() => {
    if (phase !== 'idle' || !scannerActive) return

    const html5QrCode = new BrowserMultiFormatReader()
    let stopped = false
    let controls: { stop: () => void } | null = null

    const startScanning = async () => {
      try {
        const videoElement = document.getElementById('qr-video') as HTMLVideoElement
        if (!videoElement) return

        controls = await html5QrCode.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoElement,
          (result, error) => {
            if (result && !stopped) {
              stopped = true
              console.log('QR scanned:', result.getText())
              controls?.stop()
              handleCheckIn(result.getText())
            }
            if (error && !(error instanceof NotFoundException)) {
              // Ignore NotFoundException — fires constantly while scanning
            }
          },
        )
      } catch (err) {
        console.error('Scanner error:', err)
      }
    }

    startScanning()

    return () => {
      stopped = true
      controls?.stop()
    }
  }, [phase, scannerActive, handleCheckIn])

  function reset() {
    setPhase('idle')
    setScannerActive(false)
    setMessage('')
  }

  async function submitAbsence() {
    if (!profile || !effectiveCohortId) return
    if (!absenceReason.trim()) return
    setAbsenceSubmitting(true)
    try {
      const lesson = absenceType === 'lesson' ? lessonsOnDate.find(l => l.id === absenceLessonId) : undefined
      await addDoc(collection(db, 'absence_reports'), {
        studentId: profile.uid,
        studentName: profile.displayName ?? 'Unknown',
        cohortId: effectiveCohortId,
        date: absenceDate,
        type: absenceType,
        lessonId: lesson?.id ?? null,
        lessonTitle: lesson?.title ?? null,
        reason: absenceReason.trim(),
        reportedAt: serverTimestamp(),
        status: 'pending',
      })
      setAbsenceReason('')
      setAbsenceLessonId('')
      setAbsenceSuccess(true)
      setTimeout(() => setAbsenceSuccess(false), 3000)
    } finally {
      setAbsenceSubmitting(false)
    }
  }

  async function deleteReport(id: string) {
    await deleteDoc(doc(db, 'absence_reports', id))
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 pb-bottomnav lg:pb-8">
      <div>
        <h1 className="page-title">Check In</h1>
        <p className="text-zinc-500 text-sm mt-1">Scan the QR code your teacher is showing, or report an absence below.</p>
      </div>

      {/* QR Scanner */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
        {!scannerActive && phase === 'idle' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-24 h-24 rounded-3xl bg-orange-500/20 flex items-center justify-center text-5xl">
              📷
            </div>
            <p className="text-zinc-400 text-sm text-center px-6">
              Point your camera at the QR code your teacher is showing
            </p>
            <button
              onClick={() => setScannerActive(true)}
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-8 py-3 rounded-xl text-lg transition-colors"
            >
              Start Scanning
            </button>
          </div>
        )}
        {scannerActive && phase === 'idle' && (
          <div className="relative w-full aspect-square max-w-sm mx-auto rounded-xl overflow-hidden bg-black">
            <video
              id="qr-video"
              className="w-full h-full object-cover"
              autoPlay
              muted
              playsInline
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-52 h-52 border-2 border-white rounded-lg opacity-70" />
            </div>
          </div>
        )}
        {phase === 'loading' && (
          <div className="p-12 flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-brand-100 border-t-brand-600 rounded-full animate-spin" />
            <p className="text-sm text-zinc-500">Checking in…</p>
          </div>
        )}
        {phase === 'success' && (
          <div className="p-8 flex flex-col items-center gap-3">
            <CheckCircle2 className="w-20 h-20 text-emerald-500" />
            <p className="text-xl font-bold text-zinc-100">{message}</p>
            <p className="text-sm text-zinc-400 text-center">Your attendance has been recorded.</p>
            <button onClick={reset} className="mt-2 btn-secondary py-2.5 w-full">Scan again</button>
          </div>
        )}
        {phase === 'error' && (
          <div className="p-8 flex flex-col items-center gap-3">
            <AlertCircle className="w-14 h-14 text-rose-500" />
            <p className="text-base font-semibold text-zinc-200">Check-in failed</p>
            <p className="text-sm text-zinc-500 text-center">{message}</p>
            <button onClick={reset} className="mt-2 btn-primary py-2.5 w-full">Try again</button>
          </div>
        )}
      </div>

      {/* Attendance points policy */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Star className="w-4 h-4 text-amber-500" />
          <p className="text-sm font-semibold text-zinc-200">Attendance &amp; Points</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-emerald-950/40 rounded-xl px-2 py-3">
            <p className="text-lg font-bold text-emerald-600">+5</p>
            <p className="text-xs text-zinc-500 mt-0.5 leading-tight">Attend lesson</p>
          </div>
          <div className="bg-zinc-900/50 rounded-xl px-2 py-3">
            <p className="text-lg font-bold text-zinc-400">0</p>
            <p className="text-xs text-zinc-500 mt-0.5 leading-tight">Self-reported absence</p>
          </div>
          <div className="bg-rose-950/40 rounded-xl px-2 py-3">
            <p className="text-lg font-bold text-rose-500">−5</p>
            <p className="text-xs text-zinc-500 mt-0.5 leading-tight">Teacher registers absence</p>
          </div>
        </div>
      </div>

      {/* Attendance rate card */}
      {absenceStats && absenceStats.total > 0 && (
        <div className={`rounded-2xl p-4 flex items-center gap-4 border ${
          absenceStats.attendancePct >= 90
            ? 'bg-emerald-950/40 border-emerald-800/50'
            : absenceStats.attendancePct >= 75
            ? 'bg-amber-950/40 border-amber-800/50'
            : 'bg-rose-950/40 border-rose-800/50'
        }`}>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
            absenceStats.attendancePct >= 90 ? 'bg-emerald-100' : absenceStats.attendancePct >= 75 ? 'bg-amber-100' : 'bg-rose-100'
          }`}>
            <TrendingUp className={`w-6 h-6 ${
              absenceStats.attendancePct >= 90 ? 'text-emerald-500' : absenceStats.attendancePct >= 75 ? 'text-amber-500' : 'text-rose-500'
            }`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-2xl font-bold ${
              absenceStats.attendancePct >= 90 ? 'text-emerald-300' : absenceStats.attendancePct >= 75 ? 'text-amber-300' : 'text-rose-300'
            }`}>{absenceStats.attendancePct}%</p>
            <p className="text-sm text-zinc-400">
              Attendance rate · {absenceStats.attended} of {absenceStats.total} lessons checked in
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">{absenceStats.absent} lesson{absenceStats.absent !== 1 ? 's' : ''} missed this year</p>
          </div>
          {absenceStats.attendancePct < 75 && (
            <span className="text-xs font-semibold text-rose-600 bg-rose-100 px-2 py-1 rounded-lg flex-shrink-0">Low</span>
          )}
        </div>
      )}

      {/* Absence Reporting */}
      <div className="bg-zinc-900 rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-amber-100 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h2 className="font-semibold text-zinc-200">Report Absence</h2>
        </div>
        <div className="p-5 space-y-4">
          {absenceSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 bg-emerald-950/40 rounded-xl px-3 py-2 text-sm font-medium">
              <Check className="w-4 h-4" /> Absence reported successfully.
            </div>
          )}

          {/* Date */}
          <div>
            <label className="label text-xs">Date</label>
            <input
              type="date"
              value={absenceDate}
              min={todayStr()}
              onChange={e => { setAbsenceDate(e.target.value); setAbsenceLessonId('') }}
              className="input w-full"
            />
          </div>

          {/* Type toggle */}
          <div>
            <label className="label text-xs">Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAbsenceType('full_day')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                  absenceType === 'full_day'
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : 'bg-zinc-900 border-white/15 text-zinc-400 hover:border-amber-400'
                }`}
              >
                Full Day
              </button>
              <button
                type="button"
                onClick={() => setAbsenceType('lesson')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                  absenceType === 'lesson'
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : 'bg-zinc-900 border-white/15 text-zinc-400 hover:border-amber-400'
                }`}
              >
                Specific Lesson
              </button>
            </div>
          </div>

          {/* Lesson picker */}
          {absenceType === 'lesson' && (
            <div>
              <label className="label text-xs">Lesson</label>
              {lessonsOnDate.length === 0 ? (
                <p className="text-xs text-zinc-400 px-1">No lessons found on {absenceDate}.</p>
              ) : (
                <select value={absenceLessonId} onChange={e => setAbsenceLessonId(e.target.value)} className="input w-full">
                  <option value="">Select a lesson…</option>
                  {lessonsOnDate.map(l => {
                    const t = l.startTime?.toDate?.()
                    const timeStr = t ? format(t, 'HH:mm') : ''
                    return <option key={l.id} value={l.id}>{timeStr} — {l.title}</option>
                  })}
                </select>
              )}
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="label text-xs">Reason *</label>
            <textarea
              value={absenceReason}
              onChange={e => setAbsenceReason(e.target.value)}
              rows={2}
              className="input w-full resize-none"
              placeholder="Briefly explain why you'll be absent…"
            />
          </div>

          <button
            onClick={submitAbsence}
            disabled={absenceSubmitting || !absenceReason.trim() || (absenceType === 'lesson' && !absenceLessonId)}
            className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium text-sm transition-colors"
          >
            {absenceSubmitting ? 'Submitting…' : 'Submit Absence Report'}
          </button>
        </div>
      </div>

      {/* My reports */}
      {myReports.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-300">My Reports</h2>
          {myReports.slice(0, 5).map(r => (
            <div key={r.id} className="bg-zinc-900 rounded-xl border border-white/10 px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-zinc-200">{r.date}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    r.type === 'full_day' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {r.type === 'full_day' ? 'Full day' : 'Lesson'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    r.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-900/40 text-amber-300'
                  }`}>
                    {r.status === 'reviewed' ? 'Reviewed' : 'Pending'}
                  </span>
                </div>
                {r.lessonTitle && <p className="text-xs text-zinc-500 mt-0.5">{r.lessonTitle}</p>}
                <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{r.reason}</p>
              </div>
              {r.status === 'pending' && (
                <button onClick={() => deleteReport(r.id)} className="p-1 text-zinc-300 hover:text-rose-500 transition-colors flex-shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
