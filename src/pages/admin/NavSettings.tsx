import { doc, updateDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument } from '@/hooks/useFirestore'
import {
  Calendar, MessageSquare, ClipboardList, DoorOpen, BookOpen,
  Clapperboard, Trophy, FolderOpen, BookMarked, Film,
  QrCode, ListChecks, FlaskConical, Users, SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

// ── Feature definitions ────────────────────────────────────────────────────────

interface Feature {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  student: boolean
  teacher: boolean
}

const FEATURES: Feature[] = [
  { id: 'calendar',    label: 'Calendar',         icon: Calendar,       student: true,  teacher: true  },
  { id: 'chat',        label: 'Chat',             icon: MessageSquare,  student: true,  teacher: true  },
  { id: 'assignments', label: 'Assignments',      icon: ClipboardList,  student: true,  teacher: true  },
  { id: 'booking',     label: 'Booking',          icon: DoorOpen,       student: true,  teacher: true  },
  { id: 'subjects',    label: 'Subjects',         icon: BookOpen,       student: true,  teacher: true  },
  { id: 'production',  label: 'Production',       icon: Clapperboard,   student: true,  teacher: true  },
  { id: 'prizes',      label: 'Prizes',           icon: Trophy,         student: true,  teacher: true  },
  { id: 'resources',   label: 'Resources',        icon: FolderOpen,     student: true,  teacher: true  },
  { id: 'guide',       label: 'FAQ',              icon: BookMarked,     student: true,  teacher: true  },
  { id: 'videoLab',    label: 'Video Lab',        icon: Film,           student: true,  teacher: true  },
  { id: 'checkin',     label: 'Check In',         icon: QrCode,         student: true,  teacher: false },
  { id: 'myPlan',      label: 'My Plan',          icon: ListChecks,     student: true,  teacher: false },
  { id: 'tests',       label: 'Tests',            icon: FlaskConical,   student: false, teacher: true  },
  { id: 'students',    label: 'Students',         icon: Users,          student: false, teacher: true  },
  { id: 'points',      label: 'Points',           icon: Trophy,         student: true,  teacher: false },
]

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none',
        checked ? 'bg-brand-600' : 'bg-zinc-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-zinc-900 shadow transition-transform duration-200',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

type NavVisDoc = { id: string; student: Record<string, boolean>; teacher: Record<string, boolean> }

export default function NavSettings() {
  const { data: navVis, loading } = useDocument<NavVisDoc>('settings', 'nav_visibility')

  function isEnabled(role: 'student' | 'teacher', featureId: string): boolean {
    return navVis?.[role]?.[featureId] !== false
  }

  async function toggle(role: 'student' | 'teacher', featureId: string) {
    const current = isEnabled(role, featureId)
    const ref = doc(db, 'settings', 'nav_visibility')
    try {
      await updateDoc(ref, { [`${role}.${featureId}`]: !current })
    } catch {
      // Document doesn't exist yet
      await setDoc(ref, { student: {}, teacher: {}, [role]: { [featureId]: !current } }, { merge: true })
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <SlidersHorizontal className="w-6 h-6 text-brand-500" /> Navigation Settings
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Toggle which menu items are visible for each role. Changes take effect immediately.
        </p>
      </div>

      <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden shadow-sm">
        {/* Header */}
        <div className="grid grid-cols-[1fr_72px_72px] sm:grid-cols-[1fr_120px_120px] items-center px-5 py-3 bg-zinc-900/50 border-b border-white/10">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Feature</span>
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider text-center">Teacher</span>
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider text-center">Student</span>
        </div>

        {/* Rows */}
        <div className="divide-y divide-slate-100">
          {FEATURES.map(feature => {
            const Icon = feature.icon
            const teacherOn = isEnabled('teacher', feature.id)
            const studentOn = isEnabled('student', feature.id)

            return (
              <div
                key={feature.id}
                className="grid grid-cols-[1fr_72px_72px] sm:grid-cols-[1fr_120px_120px] items-center px-5 py-3 hover:bg-white/5/50 transition-colors"
              >
                {/* Feature name */}
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-zinc-500" />
                  </div>
                  <span className="text-sm font-medium text-zinc-100">{feature.label}</span>
                </div>

                {/* Teacher toggle */}
                <div className="flex justify-center">
                  {feature.teacher
                    ? <Toggle checked={teacherOn} onChange={() => toggle('teacher', feature.id)} />
                    : <span className="text-zinc-300 text-sm">—</span>
                  }
                </div>

                {/* Student toggle */}
                <div className="flex justify-center">
                  {feature.student
                    ? <Toggle checked={studentOn} onChange={() => toggle('student', feature.id)} />
                    : <span className="text-zinc-300 text-sm">—</span>
                  }
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-zinc-400 text-center">
        Dashboard and core navigation are always visible and cannot be disabled.
      </p>
    </div>
  )
}
