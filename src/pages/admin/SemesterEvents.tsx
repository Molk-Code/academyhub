import { useState, useMemo, useEffect } from 'react'
import {
  addDoc, collection, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { SemesterEventDoc, SemesterCategoryDoc } from '@/types'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, X, Tag } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#3b82f6', '#f97316', '#22c55e', '#a855f7',
  '#f59e0b', '#ec4899', '#ef4444', '#14b8a6',
  '#06b6d4', '#84cc16', '#f43f5e', '#8b5cf6',
]

const DEFAULT_SEEDS: { name: string; color: string }[] = [
  { name: 'Admissions', color: '#3b82f6' },
  { name: 'Grades',     color: '#f59e0b' },
  { name: 'Planning',   color: '#a855f7' },
  { name: 'Equipment',  color: '#22c55e' },
  { name: 'Other',      color: '#94a3b8' },
]

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const MONTH_DAYS  = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatMmDd(mmdd: string): string {
  const [m, d] = mmdd.split('-').map(Number)
  if (!m || !d) return mmdd
  return `${MONTH_ABBR[m - 1]} ${d}`
}

function catColor(catName: string, cats: SemesterCategoryDoc[]): string {
  return cats.find(c => c.name === catName)?.color ?? '#94a3b8'
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini wheel preview
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_CUMUL = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]
const START_ANGLE = -Math.PI / 2

function dateToAngle(mmdd: string): number {
  if (!mmdd?.includes('-')) return START_ANGLE
  const [m, d] = mmdd.split('-').map(Number)
  return START_ANGLE + ((MONTH_CUMUL[m - 1] + (d - 1)) / 365) * 2 * Math.PI
}

function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

function arcPathD(cx: number, cy: number, r: number, a1: number, a2: number): string {
  if (a2 < a1) a2 += 2 * Math.PI
  if (Math.abs(a2 - a1) < 0.02) a2 = a1 + 0.02
  const s = polar(cx, cy, r, a1)
  const e = polar(cx, cy, r, a2)
  return `M${s.x.toFixed(2)},${s.y.toFixed(2)} A${r},${r} 0 ${(a2-a1)>Math.PI?1:0},1 ${e.x.toFixed(2)},${e.y.toFixed(2)}`
}

function WheelPreview({ color, startDate, endDate }: { color: string; startDate: string; endDate: string }) {
  return (
    <svg width="80" height="80" viewBox="0 0 120 120" className="flex-shrink-0">
      <circle cx="60" cy="60" r="45" fill="none" stroke="#1e293b" strokeWidth="20" />
      <path
        d={arcPathD(60, 60, 45, dateToAngle(startDate), dateToAngle(endDate || startDate))}
        fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" opacity="0.9"
      />
      <circle cx="60" cy="60" r="25" fill="#0f172a" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Color swatch picker (inline)
// ─────────────────────────────────────────────────────────────────────────────

function ColorSwatches({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (color: string) => void
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {PRESET_COLORS.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onSelect(c)}
          className="w-7 h-7 rounded-full border-2 transition-transform"
          style={{
            backgroundColor: c,
            borderColor: selected === c ? '#fff' : 'transparent',
            transform: selected === c ? 'scale(1.2)' : 'scale(1)',
          }}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Form state for event modal
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  title: string
  description: string
  category: string
  startMonth: string
  startDay: string
  endMonth: string
  endDay: string
  isActive: boolean
}

function makeEmptyForm(cats: SemesterCategoryDoc[]): FormState {
  return {
    title: '',
    description: '',
    category: cats[0]?.name ?? '',
    startMonth: '1',
    startDay: '1',
    endMonth: '1',
    endDay: '15',
    isActive: true,
  }
}

function docToForm(ev: SemesterEventDoc): FormState {
  const [sm, sd] = ev.startDate.split('-')
  const [em, ed] = ev.endDate.split('-')
  return {
    title:       ev.title,
    description: ev.description,
    category:    ev.category,
    startMonth:  String(parseInt(sm)),
    startDay:    String(parseInt(sd)),
    endMonth:    String(parseInt(em)),
    endDay:      String(parseInt(ed)),
    isActive:    ev.isActive,
  }
}

function formToPayload(f: FormState, cats: SemesterCategoryDoc[]) {
  const pad = (n: string) => String(n).padStart(2, '0')
  return {
    title:       f.title.trim(),
    description: f.description.trim(),
    category:    f.category,
    color:       catColor(f.category, cats),
    startDate:   `${pad(f.startMonth)}-${pad(f.startDay)}`,
    endDate:     `${pad(f.endMonth)}-${pad(f.endDay)}`,
    isActive:    f.isActive,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event modal
// ─────────────────────────────────────────────────────────────────────────────

function EventModal({
  initial,
  categories,
  onSave,
  onClose,
}: {
  initial?: SemesterEventDoc
  categories: SemesterCategoryDoc[]
  onSave: (data: ReturnType<typeof formToPayload>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(
    initial ? docToForm(initial) : makeEmptyForm(categories),
  )
  const [saving, setSaving] = useState(false)

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const startDays = Array.from({ length: MONTH_DAYS[parseInt(form.startMonth) - 1] ?? 31 }, (_, i) => i + 1)
  const endDays   = Array.from({ length: MONTH_DAYS[parseInt(form.endMonth) - 1] ?? 31 }, (_, i) => i + 1)
  const previewStart = `${String(form.startMonth).padStart(2,'0')}-${String(form.startDay).padStart(2,'0')}`
  const previewEnd   = `${String(form.endMonth).padStart(2,'0')}-${String(form.endDay).padStart(2,'0')}`
  const color        = catColor(form.category, categories)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try { await onSave(formToPayload(form, categories)) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className="w-full max-w-lg rounded-2xl border overflow-y-auto max-h-[90dvh]"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between p-5 border-b sticky top-0 z-10"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
            {initial ? 'Edit Event' : 'Add Semester Event'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Preview + title row */}
          <div className="flex items-start gap-4">
            <WheelPreview color={color} startDate={previewStart} endDate={previewEnd} />
            <div className="flex-1 space-y-3">
              <div>
                <label className="label text-xs">Title *</label>
                <input
                  required
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  className="input w-full"
                  placeholder="e.g. Admission Period"
                />
              </div>
              <div>
                <label className="label text-xs">Category</label>
                {categories.length === 0 ? (
                  <p className="text-xs text-amber-400 mt-1">Add at least one category below before creating events.</p>
                ) : (
                  <select value={form.category} onChange={e => set('category', e.target.value)} className="input w-full">
                    {categories.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="label text-xs">Description</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
              className="input w-full resize-none"
              placeholder="Brief description of this period…"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label text-xs">Start date</label>
              <div className="flex gap-2">
                <select value={form.startMonth} onChange={e => { set('startMonth', e.target.value); set('startDay', '1') }} className="input flex-1 min-w-0">
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select value={form.startDay} onChange={e => set('startDay', e.target.value)} className="input w-20 flex-shrink-0">
                  {startDays.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label text-xs">End date</label>
              <div className="flex gap-2">
                <select value={form.endMonth} onChange={e => { set('endMonth', e.target.value); set('endDay', '1') }} className="input flex-1 min-w-0">
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select value={form.endDay} onChange={e => set('endDay', e.target.value)} className="input w-20 flex-shrink-0">
                  {endDays.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Active</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Show on the semester wheel</p>
            </div>
            <button type="button" onClick={() => set('isActive', !form.isActive)} className="transition-colors">
              {form.isActive
                ? <ToggleRight className="w-8 h-8 text-brand-500" />
                : <ToggleLeft className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
              }
            </button>
          </div>

          <button
            type="submit"
            disabled={saving || !form.title || categories.length === 0}
            className="w-full btn-primary py-3"
          >
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Event'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories panel
// ─────────────────────────────────────────────────────────────────────────────

function CategoriesPanel({ categories, loading }: {
  categories: SemesterCategoryDoc[]
  loading: boolean
}) {
  const [newName, setNewName]   = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [adding, setAdding]     = useState(false)
  // Which category id is currently having its color edited
  const [editingColorId, setEditingColorId] = useState<string | null>(null)

  async function addCategory() {
    const name = newName.trim()
    if (!name || categories.some(c => c.name === name)) return
    setAdding(true)
    try {
      await addDoc(collection(db, 'semester_categories'), {
        name,
        color:     newColor,
        createdAt: serverTimestamp(),
      })
      setNewName('')
      setNewColor(PRESET_COLORS[0])
    } finally {
      setAdding(false)
    }
  }

  async function removeCategory(cat: SemesterCategoryDoc) {
    if (!confirm(`Remove category "${cat.name}"?\n\nExisting events keep their stored colour but will lose the category label styling.`)) return
    await deleteDoc(doc(db, 'semester_categories', cat.id))
  }

  async function updateColor(cat: SemesterCategoryDoc, color: string) {
    await updateDoc(doc(db, 'semester_categories', cat.id), { color })
    setEditingColorId(null)
  }

  return (
    <div
      className="rounded-2xl border p-5 space-y-4"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-brand-500" />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Categories</h2>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          — each category has its own colour used on the wheel
        </span>
      </div>

      {/* Category tags */}
      {!loading && categories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No categories yet. Add one below.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <div key={cat.id} className="relative">
              <span
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full select-none"
                style={{ backgroundColor: `${cat.color}22`, color: cat.color, border: `1px solid ${cat.color}44` }}
              >
                {/* Color dot — click to edit color */}
                <button
                  type="button"
                  title="Change color"
                  onClick={() => setEditingColorId(editingColorId === cat.id ? null : cat.id)}
                  className="w-3 h-3 rounded-full flex-shrink-0 hover:ring-2 ring-white/40 transition-all"
                  style={{ backgroundColor: cat.color }}
                />
                {cat.name}
                <button
                  type="button"
                  title="Remove category"
                  onClick={() => removeCategory(cat)}
                  className="ml-0.5 rounded-full opacity-60 hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>

              {/* Inline color picker below the tag */}
              {editingColorId === cat.id && (
                <div
                  className="absolute left-0 top-full mt-1 z-20 rounded-xl border p-3 shadow-xl"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', minWidth: 200 }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                    Pick colour for "{cat.name}"
                  </p>
                  <ColorSwatches
                    selected={cat.color}
                    onSelect={color => updateColor(cat, color)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dismiss color picker if clicking outside */}
      {editingColorId && (
        <div className="fixed inset-0 z-10" onClick={() => setEditingColorId(null)} />
      )}

      {/* Add new category */}
      <div className="space-y-2 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs font-medium pt-1" style={{ color: 'var(--text-secondary)' }}>New category</p>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory() } }}
            className="input flex-1 min-w-[140px]"
            placeholder="Category name…"
            maxLength={40}
          />
          <ColorSwatches selected={newColor} onSelect={setNewColor} />
          <button
            type="button"
            onClick={addCategory}
            disabled={adding || !newName.trim() || categories.some(c => c.name === newName.trim())}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-40 flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function SemesterEvents() {
  const { profile } = useAuth()
  const { data: events } = useCollection<SemesterEventDoc>('semester_events')
  const { data: categoryDocs, loading: catsLoading } = useCollection<SemesterCategoryDoc>(
    'semester_categories',
    [orderBy('createdAt', 'asc')],
  )

  // Seed default categories once on first load if none exist
  useEffect(() => {
    if (catsLoading || categoryDocs.length > 0) return
    async function seed() {
      for (const s of DEFAULT_SEEDS) {
        await addDoc(collection(db, 'semester_categories'), {
          name:      s.name,
          color:     s.color,
          createdAt: serverTimestamp(),
        })
      }
    }
    seed()
  }, [catsLoading, categoryDocs.length])

  const sorted = useMemo(
    () => [...events].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [events],
  )

  const [modal, setModal] = useState<'add' | SemesterEventDoc | null>(null)

  async function handleSave(data: ReturnType<typeof formToPayload>) {
    if (modal === 'add') {
      await addDoc(collection(db, 'semester_events'), {
        ...data,
        createdBy: profile!.uid,
        createdAt: serverTimestamp(),
      })
    } else if (modal && typeof modal === 'object') {
      await updateDoc(doc(db, 'semester_events', modal.id), data)
    }
    setModal(null)
  }

  async function toggleActive(ev: SemesterEventDoc) {
    await updateDoc(doc(db, 'semester_events', ev.id), { isActive: !ev.isActive })
  }

  async function handleDelete(ev: SemesterEventDoc) {
    if (!confirm(`Delete "${ev.title}"? This cannot be undone.`)) return
    await deleteDoc(doc(db, 'semester_events', ev.id))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Semester Events</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Recurring annual events shown on the teacher semester wheel.
          </p>
        </div>
        <button onClick={() => setModal('add')} className="btn-primary">
          <Plus className="w-4 h-4" /> Add Event
        </button>
      </div>

      {/* Categories panel */}
      <CategoriesPanel categories={categoryDocs} loading={catsLoading} />

      {/* Events table */}
      {sorted.length === 0 ? (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-12 text-center">
          <p className="text-zinc-400">No semester events yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Event</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden sm:table-cell">Dates</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sorted.map(ev => {
                const color = catColor(ev.category, categoryDocs)
                return (
                  <tr key={ev.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ev.color }} />
                        <div>
                          <p className="text-sm font-medium text-zinc-200">{ev.title}</p>
                          {ev.description && (
                            <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{ev.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 hidden sm:table-cell">
                      <span className="text-sm text-zinc-300 font-mono">
                        {formatMmDd(ev.startDate)} – {formatMmDd(ev.endDate)}
                      </span>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
                      >
                        {ev.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive(ev)} className="transition-colors">
                        {ev.isActive
                          ? <ToggleRight className="w-6 h-6 text-brand-500 mx-auto" />
                          : <ToggleLeft className="w-6 h-6 text-zinc-600 mx-auto" />
                        }
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => setModal(ev)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(ev)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <EventModal
          initial={modal === 'add' ? undefined : modal}
          categories={categoryDocs}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
