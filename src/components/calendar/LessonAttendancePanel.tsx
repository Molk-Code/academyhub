import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { UserDoc } from '@/types'
import { CheckCircle2, Users } from 'lucide-react'

interface AttendanceRecord {
  studentId: string
  displayName: string
  checkedInAt: { toDate: () => Date } | null
}

export default function LessonAttendancePanel({
  lessonId,
  cohortId,
}: {
  lessonId: string
  cohortId: string | null
}) {
  const { role, roles } = useAuth()
  const isStaff = roles.includes('teacher') || roles.includes('admin') || role === 'teacher' || role === 'admin'

  const [attendees, setAttendees] = useState<AttendanceRecord[]>([])
  const [loading,   setLoading]   = useState(true)

  const { data: cohortStudents } = useCollection<UserDoc>(
    'users',
    cohortId && isStaff ? [where('cohortId', '==', cohortId)] : [],
    !!(cohortId && isStaff),
    cohortId ?? '',
  )

  useEffect(() => {
    if (!lessonId) return
    setLoading(true)
    const unsub = onSnapshot(
      query(collection(db, 'lessons', lessonId, 'attendance'), orderBy('checkedInAt', 'asc')),
      snap => {
        setAttendees(snap.docs.map(d => d.data() as AttendanceRecord))
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [lessonId])

  const checkedInIds = new Set(attendees.map(a => a.studentId))
  const notCheckedIn = isStaff
    ? cohortStudents.filter(u => !checkedInIds.has(u.uid) && (u.role === 'student' || u.roles?.includes('student')))
    : []

  if (loading) {
    return <p className="text-xs text-zinc-400 py-2">Loading attendance…</p>
  }

  return (
    <div className="space-y-3">
      {/* Checked-in list */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-3.5 h-3.5 text-zinc-400" />
          <p className="text-xs font-semibold text-zinc-400">
            Checked in{' '}
            <span className="text-emerald-600 font-bold">{attendees.length}</span>
            {isStaff && cohortStudents.length > 0 && (
              <span className="text-zinc-400 font-normal"> / {cohortStudents.filter(u => u.role === 'student' || u.roles?.includes('student')).length}</span>
            )}
          </p>
        </div>
        {attendees.length === 0 ? (
          <p className="text-xs text-zinc-400 bg-zinc-900/50 rounded-lg px-3 py-2">No check-ins yet.</p>
        ) : (
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {attendees.map(a => (
              <div key={a.studentId} className="flex items-center gap-2 px-2 py-1.5 bg-emerald-950/40 rounded-lg border border-emerald-800/50">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                <span className="text-xs font-medium text-zinc-200 flex-1">{a.displayName}</span>
                {a.checkedInAt && (
                  <span className="text-xs text-zinc-400 tabular-nums">
                    {a.checkedInAt.toDate().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Not checked in (staff only) */}
      {isStaff && notCheckedIn.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-500 mb-1.5">
            Not checked in <span className="text-rose-500 font-bold">{notCheckedIn.length}</span>
          </p>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {notCheckedIn.map(u => (
              <div key={u.uid} className="flex items-center gap-2 px-2 py-1.5 bg-zinc-900/50 rounded-lg border border-white/8">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white/15 flex-shrink-0" />
                <span className="text-xs text-zinc-500 flex-1">{u.displayName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
