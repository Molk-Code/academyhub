import { useState } from 'react'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument } from '@/hooks/useFirestore'
import type { ExperienceLevel } from '@/types'
import { Trophy, Plus, Trash2, Pencil, Check, X, Star, BarChart2 } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'
import { nanoid } from 'nanoid'

interface LevelDoc { id: string; levels: ExperienceLevel[]; showLeaderboard?: boolean }

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

function LevelForm({
  initial,
  usedPoints,
  onSave,
  onCancel,
}: {
  initial?: ExperienceLevel
  usedPoints: number[]
  onSave: (l: ExperienceLevel) => void
  onCancel: () => void
}) {
  const [name,   setName]   = useState(initial?.name ?? '')
  const [points, setPoints] = useState(initial?.pointsRequired?.toString() ?? '')

  const pts = parseInt(points, 10)
  const conflict = !isNaN(pts) && usedPoints.includes(pts) && pts !== initial?.pointsRequired

  function save() {
    if (!name.trim() || isNaN(pts) || pts < 0 || conflict) return
    onSave({ id: initial?.id ?? nanoid(), name: name.trim(), pointsRequired: pts })
  }

  return (
    <div className="bg-zinc-800/60 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Level name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="input w-full"
            placeholder="e.g. Rookie, Pro, Legend"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Points required</label>
          <input
            type="number"
            value={points}
            onChange={e => setPoints(e.target.value)}
            className="input w-full"
            placeholder="e.g. 100"
            min={0}
          />
          {conflict && <p className="text-xs text-rose-400 mt-1">Another level already uses {pts} points.</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={!name.trim() || isNaN(pts) || pts < 0 || conflict}
          className="btn-primary py-1.5 px-4 text-sm disabled:opacity-40"
        >
          <Check className="w-3.5 h-3.5 inline mr-1" />
          {initial ? 'Save' : 'Add level'}
        </button>
        <button onClick={onCancel} className="btn-secondary py-1.5 px-3 text-sm">
          <X className="w-3.5 h-3.5 inline mr-1" /> Cancel
        </button>
      </div>
    </div>
  )
}

export default function ExperienceLevels() {
  const { data: levelData, loading } = useDocument<LevelDoc>('settings', 'experience_levels')
  const [showAdd,   setShowAdd]   = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const levels: ExperienceLevel[] = [...(levelData?.levels ?? [])].sort((a, b) => a.pointsRequired - b.pointsRequired)

  async function saveField(field: string, value: unknown) {
    const ref = doc(db, 'settings', 'experience_levels')
    try {
      await updateDoc(ref, { [field]: value })
    } catch {
      await setDoc(ref, { [field]: value }, { merge: true })
    }
  }

  async function saveLevels(next: ExperienceLevel[]) {
    await saveField('levels', next)
  }

  async function toggleLeaderboard() {
    await saveField('showLeaderboard', !(levelData?.showLeaderboard ?? true))
  }

  async function handleAdd(level: ExperienceLevel) {
    await saveLevels([...levels, level])
    setShowAdd(false)
  }

  async function handleEdit(updated: ExperienceLevel) {
    await saveLevels(levels.map(l => l.id === updated.id ? updated : l))
    setEditingId(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this level?')) return
    await saveLevels(levels.filter(l => l.id !== id))
  }

  if (loading) return <LoadingSpinner />

  const usedPoints = levels.map(l => l.pointsRequired)

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Trophy className="w-6 h-6 text-amber-500" /> Experience Levels
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Define levels students unlock by earning points. A notification is sent when a student reaches a new level.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Levels</h2>
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 btn bg-brand-600 text-white hover:bg-brand-500 py-2 text-sm"
            >
              <Plus className="w-4 h-4" /> Add level
            </button>
          )}
        </div>

        {showAdd && (
          <LevelForm
            usedPoints={usedPoints}
            onSave={handleAdd}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {levels.length > 0 ? (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/5">
            {levels.map((level, i) => (
              <div key={level.id}>
                {editingId === level.id ? (
                  <div className="p-4">
                    <LevelForm
                      initial={level}
                      usedPoints={usedPoints.filter(p => p !== level.pointsRequired)}
                      onSave={handleEdit}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.03] transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                      <Star className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100">{level.name}</p>
                      <p className="text-xs text-zinc-500">{level.pointsRequired === 0 ? 'Starting level' : `${level.pointsRequired} points required`}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingId(level.id)}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(level.id)}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-900/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : !showAdd && (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl px-5 py-10 text-center">
            <Trophy className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-zinc-500 text-sm">No levels yet. Add your first one above.</p>
          </div>
        )}
      </div>

      {/* Leaderboard toggle */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
            <BarChart2 className="w-4 h-4 text-zinc-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-100">Class Leaderboard</p>
            <p className="text-xs text-zinc-500 mt-0.5">Show points leaderboard on the student dashboard.</p>
          </div>
        </div>
        <Toggle
          checked={levelData?.showLeaderboard ?? true}
          onChange={toggleLeaderboard}
        />
      </div>

      <div className="bg-zinc-900/50 border border-white/8 rounded-xl px-4 py-3 text-xs text-zinc-500 space-y-1">
        <p className="font-medium text-zinc-400">How it works</p>
        <p>• Students receive an in-app notification and push notification when they cross a level threshold.</p>
        <p>• Each student is only notified once per level — changing the points value will not re-trigger past notifications.</p>
        <p>• Levels with 0 points are the starting level and do not trigger notifications.</p>
        <p>• Levels trigger on a student's total earned points, not their spendable balance.</p>
      </div>
    </div>
  )
}
