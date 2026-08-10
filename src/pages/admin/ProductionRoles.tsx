import { useState, useEffect, useRef } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { Clapperboard, Plus, Pencil, Trash2, Check, X, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurrency } from '@/hooks/useCurrency'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import type { CrewRoleDoc } from '@/types'

export default function ProductionRoles() {
  const { data: roles, loading } = useCollection<CrewRoleDoc>('crew_roles', [orderBy('order', 'asc')])
  const { symbol } = useCurrency()

  // ── Production settings ───────────────────────────────────────────────────
  const [maxHours,       setMaxHours]       = useState(8)
  const [maxShots,       setMaxShots]       = useState(25)
  const [showLeaderboard, setShowLeaderboard] = useState(true)
  const [saved,          setSaved]          = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'production')).then(snap => {
      if (snap.exists()) {
        setMaxHours(snap.data().maxHoursPerDay ?? 8)
        setMaxShots(snap.data().maxShotsPerDay ?? 25)
        setShowLeaderboard(snap.data().showLeaderboard !== false)
      }
    })
  }, [])

  const saveSettings = async () => {
    await setDoc(doc(db, 'settings', 'production'), {
      maxHoursPerDay: maxHours,
      maxShotsPerDay: maxShots,
      showLeaderboard,
    }, { merge: true })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editName,    setEditName]    = useState('')
  const [editDayRate, setEditDayRate] = useState('')
  const [newName,     setNewName]     = useState('')
  const [adding,     setAdding]     = useState(false)
  const [dragId,     setDragId]     = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // Refs so document-level touch listeners never have stale closures
  const rolesRef    = useRef(roles)
  const dragIdRef   = useRef<string | null>(null)
  const dragOverRef = useRef<string | null>(null)
  const touchActive = useRef(false)

  useEffect(() => { rolesRef.current = roles }, [roles])
  useEffect(() => { dragIdRef.current = dragId }, [dragId])
  useEffect(() => { dragOverRef.current = dragOverId }, [dragOverId])

  // ── Reorder helper (used by both mouse and touch) ──────────────────────────
  async function doReorder(fromId: string, toId: string) {
    const list = rolesRef.current
    const from = list.findIndex(r => r.id === fromId)
    const to   = list.findIndex(r => r.id === toId)
    if (from === -1 || to === -1) return
    const reordered = [...list]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    await Promise.all(
      reordered.map((r, i) =>
        r.order !== i + 1 ? updateDoc(doc(db, 'crew_roles', r.id), { order: i + 1 }) : Promise.resolve(),
      ),
    )
  }

  // ── Non-passive document touch listeners (mobile drag) ─────────────────────
  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      if (!touchActive.current) return
      e.preventDefault()   // block page scroll while dragging
      const touch = e.touches[0]
      const el    = document.elementFromPoint(touch.clientX, touch.clientY)
      const row   = el?.closest('[data-role-id]')
      const over  = row?.getAttribute('data-role-id') ?? null
      if (over !== dragOverRef.current) {
        dragOverRef.current = over
        setDragOverId(over)
      }
    }
    function onTouchEnd() {
      if (!touchActive.current) return
      touchActive.current = false
      const from = dragIdRef.current
      const to   = dragOverRef.current
      setDragId(null)
      setDragOverId(null)
      if (from && to && from !== to) doReorder(from, to)
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend',  onTouchEnd)
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend',  onTouchEnd)
    }
  }, []) // intentionally no deps — reads fresh values via refs

  // ── Mouse drag handler ─────────────────────────────────────────────────────
  async function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return }
    await doReorder(dragId, targetId)
    setDragId(null)
    setDragOverId(null)
  }

  async function addRole() {
    if (!newName.trim()) return
    const maxOrder = roles.reduce((m, r) => Math.max(m, r.order), 0)
    await addDoc(collection(db, 'crew_roles'), { name: newName.trim(), order: maxOrder + 1 })
    setNewName('')
    setAdding(false)
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    const dayRate = editDayRate !== '' ? Number(editDayRate) : undefined
    await updateDoc(doc(db, 'crew_roles', id), {
      name: editName.trim(),
      ...(dayRate !== undefined ? { dayRate } : {}),
    })
    setEditingId(null)
  }

  async function deleteRole(id: string) {
    if (!confirm('Delete this crew role? Existing assignments will keep the role name.')) return
    await deleteDoc(doc(db, 'crew_roles', id))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Clapperboard className="w-6 h-6 text-brand-500" /> Production Settings
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Configure production limits and crew roles for student productions.
        </p>
      </div>

      {/* ── Production Limits ─────────────────────────────────────────────── */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
        <h2 className="text-lg font-semibold mb-1 text-zinc-100">Production Limits</h2>
        <p className="text-sm text-zinc-400 mb-6">
          Set daily limits for working hours and shots. The production planning tool warns students when these limits are exceeded.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">⏱ Max working hours per day</label>
            <div className="flex items-center gap-3">
              <input
                type="number" min={1} max={24}
                value={maxHours}
                onChange={e => setMaxHours(Number(e.target.value))}
                onBlur={saveSettings}
                className="w-24 bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-white font-semibold text-center focus:border-brand-500/50 outline-none focus:ring-1 focus:ring-brand-500/30"
              />
              <span className="text-sm text-zinc-400">hours</span>
            </div>
            <p className="text-xs text-zinc-500 mt-2">A warning is shown in the schedule when a shooting day exceeds this limit.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">🎬 Max shots per day</label>
            <div className="flex items-center gap-3">
              <input
                type="number" min={1} max={200}
                value={maxShots}
                onChange={e => setMaxShots(Number(e.target.value))}
                onBlur={saveSettings}
                className="w-24 bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-white font-semibold text-center focus:border-brand-500/50 outline-none focus:ring-1 focus:ring-brand-500/30"
              />
              <span className="text-sm text-zinc-400">shots</span>
            </div>
            <p className="text-xs text-zinc-500 mt-2">A warning is shown when the total shots for a shooting day exceeds this limit.</p>
          </div>
        </div>
        <div className="flex items-center justify-between py-3 border-t border-white/8 mt-6">
          <div>
            <p className="text-sm font-medium text-zinc-300">🏆 Show points leaderboard</p>
            <p className="text-xs text-zinc-500 mt-0.5">Display a top-5 leaderboard on the student dashboard.</p>
          </div>
          <button
            onClick={() => { const next = !showLeaderboard; setShowLeaderboard(next); saveSettings() }}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
              showLeaderboard ? 'bg-brand-500' : 'bg-zinc-700',
            )}
          >
            <span className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
              showLeaderboard ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        </div>
        {saved && <p className="text-xs text-emerald-400 mt-4">✓ Settings saved</p>}
      </div>

      {/* ── Crew Roles ────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-zinc-200 mb-1">Crew Roles</h2>
        <p className="text-sm text-zinc-500 mb-4">Define the crew roles available in student productions. Drag to reorder.</p>
      </div>

      <div className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
        {roles.length === 0 && !adding && (
          <div className="px-5 py-10 text-center text-zinc-500 text-sm">
            No crew roles defined yet. Add one below.
          </div>
        )}
        <div className="divide-y divide-white/8">
          {roles.map(role => (
            <div
              key={role.id}
              data-role-id={role.id}
              draggable={editingId !== role.id}
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragId(role.id) }}
              onDragOver={e => { e.preventDefault(); if (dragOverId !== role.id) setDragOverId(role.id) }}
              onDrop={() => handleDrop(role.id)}
              onDragEnd={() => { setDragId(null); setDragOverId(null) }}
              className={cn(
                'flex items-center gap-3 px-5 py-3 transition-colors relative',
                dragId === role.id && 'opacity-40',
                dragOverId === role.id && dragId !== role.id && '[&]:border-t-0',
              )}
              style={dragOverId === role.id && dragId !== role.id ? { boxShadow: 'inset 0 2px 0 0 rgb(99 102 241)' } : undefined}
            >
              {/* Grip handle — both mouse cursor-grab and touch drag initiation */}
              <div
                className={cn(
                  'flex-shrink-0 touch-none select-none p-1 -m-1',
                  editingId === role.id ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                )}
                onTouchStart={editingId !== role.id ? e => {
                  e.preventDefault()
                  touchActive.current    = true
                  dragIdRef.current      = role.id
                  dragOverRef.current    = null
                  setDragId(role.id)
                  setDragOverId(null)
                } : undefined}
              >
                <GripVertical className={cn(
                  'w-4 h-4 transition-colors',
                  editingId === role.id ? 'text-zinc-800' : 'text-zinc-600 hover:text-zinc-400',
                )} />
              </div>

              {editingId === role.id ? (
                <>
                  <div className="flex-1 flex gap-2">
                    <input
                      autoFocus
                      className="flex-1 bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                      value={editName}
                      placeholder="Role name"
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit(role.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <div className="flex items-center gap-1 bg-zinc-800 border border-white/10 rounded-lg px-2">
                      <span className="text-xs text-zinc-500">SEK/day</span>
                      <input
                        type="number"
                        min={0}
                        className="w-20 bg-transparent py-1.5 text-sm text-zinc-100 focus:outline-none text-right"
                        value={editDayRate}
                        placeholder="0"
                        onChange={e => setEditDayRate(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit(role.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                    </div>
                  </div>
                  <button onClick={() => saveEdit(role.id)} className="p-1.5 text-emerald-400 hover:text-emerald-300 transition-colors">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-zinc-200">{role.name}</span>
                  {role.dayRate != null && (
                    <span className="text-xs text-zinc-500 mr-1">{role.dayRate.toLocaleString('sv-SE')} {symbol}/day</span>
                  )}
                  <button
                    onClick={() => { setEditingId(role.id); setEditName(role.name); setEditDayRate(role.dayRate != null ? String(role.dayRate) : '') }}
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded-lg hover:bg-white/5"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteRole(role.id)}
                    className="p-1.5 text-zinc-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-white/5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}

          {adding && (
            <div className="flex items-center gap-3 px-5 py-3">
              <GripVertical className="w-4 h-4 text-zinc-700 flex-shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                value={newName}
                placeholder="Role name…"
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addRole()
                  if (e.key === 'Escape') { setAdding(false); setNewName('') }
                }}
              />
              <button onClick={addRole} className="p-1.5 text-emerald-400 hover:text-emerald-300 transition-colors">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => { setAdding(false); setNewName('') }} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add crew role
        </button>
      )}
    </div>
  )
}
