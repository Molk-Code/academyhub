import { useState } from 'react'
import { doc, updateDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument } from '@/hooks/useFirestore'
import {
  Calendar, MessageSquare, ClipboardList, DoorOpen, BookOpen,
  Clapperboard, Trophy, FolderOpen, BookMarked, Film,
  QrCode, ListChecks, FlaskConical, Users, SlidersHorizontal,
  LayoutDashboard, User, UtensilsCrossed, Car, CalendarRange,
  Video, CircleDot, Package, Plus, Trash2, ExternalLink, Pencil, X, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { nanoid } from 'nanoid'

// ── Feature definitions ────────────────────────────────────────────────────────

interface Feature {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  student: boolean
  teacher: boolean
}

const FEATURES: Feature[] = [
  // ── Both roles ───────────────────────────────────────────────────────────────
  { id: 'calendar',         label: 'Calendar',            icon: Calendar,        student: true,  teacher: true  },
  { id: 'chat',             label: 'Chat',                icon: MessageSquare,   student: true,  teacher: true  },
  { id: 'assignments',      label: 'Assignments',         icon: ClipboardList,   student: true,  teacher: true  },
  { id: 'subjects',         label: 'Subjects',            icon: BookOpen,        student: true,  teacher: true  },
  { id: 'production',       label: 'Production',          icon: Clapperboard,    student: true,  teacher: true  },
  { id: 'prizes',           label: 'Prizes',              icon: Trophy,          student: true,  teacher: true  },
  { id: 'resources',        label: 'Resources',           icon: FolderOpen,      student: true,  teacher: true  },
  { id: 'booking',          label: 'Booking',             icon: DoorOpen,        student: true,  teacher: true  },
  { id: 'guide',            label: 'School Guide',        icon: BookMarked,      student: true,  teacher: true  },
  { id: 'productionPeriod', label: 'Production Period',   icon: CalendarRange,   student: true,  teacher: true  },
  // ── Teacher only ─────────────────────────────────────────────────────────────
  { id: 'students',         label: 'Students',            icon: Users,           student: false, teacher: true  },
  { id: 'notebook',         label: 'Notebook',            icon: BookMarked,      student: false, teacher: true  },
  { id: 'gradebook',        label: 'Grade Book',          icon: BookOpen,        student: false, teacher: true  },
  { id: 'tests',            label: 'Tests',               icon: FlaskConical,    student: false, teacher: true  },
  { id: 'videos',           label: 'Videos',              icon: Video,           student: false, teacher: true  },
  { id: 'semesterWheel',    label: 'Semester Wheel',      icon: CircleDot,       student: false, teacher: true  },
  { id: 'videoLab',         label: 'Video Lab',           icon: Film,            student: true,  teacher: true  },
  // ── Student only ─────────────────────────────────────────────────────────────
  { id: 'dashboard',        label: 'Dashboard',           icon: LayoutDashboard, student: true,  teacher: false },
  { id: 'profile',          label: 'Profile',             icon: User,            student: true,  teacher: false },
  { id: 'checkin',          label: 'Check In',            icon: QrCode,          student: true,  teacher: false },
  { id: 'semester',         label: 'Semester',            icon: CalendarRange,   student: true,  teacher: false },
  { id: 'equipment',        label: 'Equipment Booking',   icon: Package,         student: true,  teacher: false },
  { id: 'myPlan',           label: 'My Plan',             icon: ListChecks,      student: true,  teacher: false },
  { id: 'points',           label: 'Points',              icon: Trophy,          student: true,  teacher: false },
  { id: 'roomBooking',      label: 'Booking – Room',      icon: DoorOpen,        student: true,  teacher: false },
  { id: 'foodBox',          label: 'Booking – Food Box',  icon: UtensilsCrossed, student: true,  teacher: false },
  { id: 'vehicle',          label: 'Booking – Vehicle',   icon: Car,             student: true,  teacher: false },
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

// ── Custom link types ──────────────────────────────────────────────────────────

export interface CustomLink { id: string; label: string; url: string; roles: ('student' | 'teacher')[] }

// ── Custom link form ───────────────────────────────────────────────────────────

function CustomLinkForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: CustomLink
  onSave: (link: CustomLink) => void
  onCancel: () => void
}) {
  const [label,    setLabel]    = useState(initial?.label ?? '')
  const [url,      setUrl]      = useState(initial?.url ?? '')
  const [roles,    setRoles]    = useState<('student' | 'teacher')[]>(initial?.roles ?? ['student', 'teacher'])
  const [urlError, setUrlError] = useState('')

  function toggleRole(role: 'student' | 'teacher') {
    setRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }

  function handleSave() {
    const trimUrl = url.trim()
    const trimLabel = label.trim()
    if (!trimLabel || !trimUrl || roles.length === 0) return
    const withScheme = trimUrl.startsWith('http') ? trimUrl : `https://${trimUrl}`
    setUrlError('')
    try {
      const parsed = new URL(withScheme)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setUrlError('Only http:// and https:// URLs are allowed.')
        return
      }
      onSave({ id: initial?.id ?? nanoid(), label: trimLabel, url: withScheme, roles })
    } catch {
      setUrlError('Enter a valid URL (e.g. https://example.com).')
    }
  }

  return (
    <div className="bg-zinc-800/60 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Link label</label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="input w-full"
            placeholder="e.g. School website"
            autoFocus
          />
        </div>
        <div>
          <label className="label">URL</label>
          <input
            value={url}
            onChange={e => { setUrl(e.target.value); setUrlError('') }}
            className="input w-full"
            placeholder="https://example.com"
          />
          {urlError && <p className="text-xs text-rose-400 mt-1">{urlError}</p>}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-zinc-400 font-medium">Show for:</span>
        {(['teacher', 'student'] as const).map(role => (
          <label key={role} className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={() => toggleRole(role)}
              className="w-4 h-4 accent-brand-500"
            />
            <span className="text-sm text-zinc-300 capitalize">{role}s</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!label.trim() || !url.trim() || roles.length === 0}
          className="btn-primary py-1.5 px-4 text-sm disabled:opacity-40"
        >
          <Check className="w-3.5 h-3.5 inline mr-1" />
          {initial ? 'Save' : 'Add link'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary py-1.5 px-3 text-sm">
          <X className="w-3.5 h-3.5 inline mr-1" />
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

type NavVisDoc = {
  id: string
  student: Record<string, boolean>
  teacher: Record<string, boolean>
  customLinks?: CustomLink[]
}

export default function NavSettings() {
  const { data: navVis, loading } = useDocument<NavVisDoc>('settings', 'nav_visibility')
  const [showAddForm,  setShowAddForm]  = useState(false)
  const [editingLink,  setEditingLink]  = useState<CustomLink | null>(null)

  const customLinks: CustomLink[] = navVis?.customLinks ?? []

  function isEnabled(role: 'student' | 'teacher', featureId: string): boolean {
    return navVis?.[role]?.[featureId] !== false
  }

  async function toggle(role: 'student' | 'teacher', featureId: string) {
    const current = isEnabled(role, featureId)
    const ref = doc(db, 'settings', 'nav_visibility')
    try {
      await updateDoc(ref, { [`${role}.${featureId}`]: !current })
    } catch {
      await setDoc(ref, { student: {}, teacher: {}, [role]: { [featureId]: !current } }, { merge: true })
    }
  }

  async function saveCustomLinks(links: CustomLink[]) {
    const ref = doc(db, 'settings', 'nav_visibility')
    try {
      await updateDoc(ref, { customLinks: links })
    } catch {
      await setDoc(ref, { student: {}, teacher: {}, customLinks: links }, { merge: true })
    }
  }

  async function handleAddLink(link: CustomLink) {
    await saveCustomLinks([...customLinks, link])
    setShowAddForm(false)
  }

  async function handleEditLink(updated: CustomLink) {
    await saveCustomLinks(customLinks.map(l => l.id === updated.id ? updated : l))
    setEditingLink(null)
  }

  async function handleDeleteLink(id: string) {
    await saveCustomLinks(customLinks.filter(l => l.id !== id))
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
        <div className="divide-y divide-white/5">
          {FEATURES.map(feature => {
            const Icon = feature.icon
            const teacherOn = isEnabled('teacher', feature.id)
            const studentOn = isEnabled('student', feature.id)

            return (
              <div
                key={feature.id}
                className="grid grid-cols-[1fr_72px_72px] sm:grid-cols-[1fr_120px_120px] items-center px-5 py-3 hover:bg-white/5 transition-colors"
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

      {/* Custom links section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Custom Menu Links</h2>
            <p className="text-zinc-500 text-sm mt-0.5">Add shortcut links to external sites in the student or teacher sidebar.</p>
          </div>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 btn bg-brand-600 text-white hover:bg-brand-500 py-2 text-sm"
            >
              <Plus className="w-4 h-4" /> Add link
            </button>
          )}
        </div>

        {showAddForm && (
          <CustomLinkForm onSave={handleAddLink} onCancel={() => setShowAddForm(false)} />
        )}

        {customLinks.length > 0 && (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden shadow-sm divide-y divide-white/5">
            {customLinks.map(link => (
              <div key={link.id}>
                {editingLink?.id === link.id ? (
                  <div className="p-4">
                    <CustomLinkForm
                      initial={link}
                      onSave={handleEditLink}
                      onCancel={() => setEditingLink(null)}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                      <ExternalLink className="w-4 h-4 text-zinc-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-100">{link.label}</p>
                      <p className="text-xs text-zinc-500 truncate">{link.url}</p>
                    </div>
                    <div className="flex items-center gap-1.5 mr-3">
                      {link.roles.map(r => (
                        <span key={r} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-white/10 capitalize">
                          {r}s
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => setEditingLink(link)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteLink(link.id)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-900/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {customLinks.length === 0 && !showAddForm && (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl px-5 py-8 text-center text-zinc-500 text-sm">
            No custom links yet.
          </div>
        )}
      </div>

    </div>
  )
}
