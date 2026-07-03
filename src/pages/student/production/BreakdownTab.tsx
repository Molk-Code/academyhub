import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { doc, updateDoc, addDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { ProductionSceneDoc, ProductionCastDoc, ProductionLocationDoc } from '@/types'
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, MapPin } from 'lucide-react'

// Eighths → display string: 1→"1/8", 8→"1", 9→"1 1/8"
function fmtPages(eighths: number): string {
  if (!eighths) return ''
  const whole = Math.floor(eighths / 8)
  const rem   = eighths % 8
  if (whole === 0) return `${rem}/8`
  if (rem   === 0) return `${whole}`
  return `${whole} ${rem}/8`
}

// Select options 1/8 … 5 pages
const PAGE_OPTIONS: { value: number; label: string }[] = Array.from({ length: 40 }, (_, i) => ({
  value: i + 1,
  label: fmtPages(i + 1),
}))

const SCENE_BG: Record<string, string> = {
  'INT-Day':   'bg-sky-950/20 border-sky-900/40',
  'EXT-Day':   'bg-amber-950/20 border-amber-900/40',
  'INT-Night': 'bg-indigo-950/35 border-indigo-900/50',
  'EXT-Night': 'bg-purple-950/30 border-purple-900/50',
}

function EditInput({
  value, placeholder = '—', className = '', canEdit, onChange, onBlur,
}: {
  value: string; placeholder?: string; className?: string; canEdit: boolean
  onChange: (v: string) => void; onBlur: (v: string) => void
}) {
  return canEdit ? (
    <input
      className={cn(
        'bg-transparent w-full focus:bg-zinc-800/80 rounded px-1.5 py-1 text-sm text-zinc-200',
        'placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors',
        className,
      )}
      value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onBlur={e => onBlur(e.target.value)}
    />
  ) : (
    <span className={cn('text-sm text-zinc-300', className)}>
      {value || <span className="text-zinc-600">—</span>}
    </span>
  )
}

// Auto-sizing single-line cell: CSS grid overlay so column width = text width.
// Ghost span (invisible, in-flow) sizes the grid cell; input sits in same cell.
function AutoInput({
  value, placeholder = '—', minW = 'min-w-[70px]', canEdit, onChange, onBlur,
}: {
  value: string; placeholder?: string; minW?: string; canEdit: boolean
  onChange: (v: string) => void; onBlur: (v: string) => void
}) {
  const shared = 'col-start-1 row-start-1 text-sm px-1.5 py-1 whitespace-pre'
  return (
    <div className={cn('inline-grid', minW)}>
      <span className={cn(shared, 'invisible pointer-events-none')}>{value || placeholder}</span>
      {canEdit ? (
        <input
          className={cn(shared, 'bg-transparent focus:bg-zinc-800/80 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors w-full')}
          value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onBlur={e => onBlur(e.target.value)}
        />
      ) : (
        <span className={cn(shared, 'text-zinc-300')}>
          {value || <span className="text-zinc-600">—</span>}
        </span>
      )}
    </div>
  )
}

// Auto-height multi-line cell: normal flow textarea so the row grows naturally.
// Width is fixed via minW; height auto-expands without overlapping other rows.
function AutoTextarea({
  value, placeholder = '—', minW = 'min-w-[150px]', canEdit, onChange, onBlur,
}: {
  value: string; placeholder?: string; minW?: string; canEdit: boolean
  onChange: (v: string) => void; onBlur: (v: string) => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!taRef.current) return
    taRef.current.style.height = 'auto'
    taRef.current.style.height = `${taRef.current.scrollHeight}px`
  }, [value])
  return canEdit ? (
    <textarea
      ref={taRef} rows={1}
      className={cn('block bg-transparent focus:bg-zinc-800/80 rounded px-1.5 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors resize-none overflow-hidden', minW)}
      value={value} placeholder={placeholder}
      onChange={e => { onChange(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px` }}
      onBlur={e => onBlur(e.target.value)}
    />
  ) : (
    <span className={cn('block text-sm text-zinc-300 whitespace-pre-wrap px-1.5 py-1', minW)}>
      {value || <span className="text-zinc-600">—</span>}
    </span>
  )
}

function EditTextarea({
  value, placeholder = '—', className = '', canEdit, onChange, onBlur,
}: {
  value: string; placeholder?: string; className?: string; canEdit: boolean
  onChange: (v: string) => void; onBlur: (v: string) => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!taRef.current) return
    taRef.current.style.height = 'auto'
    taRef.current.style.height = `${taRef.current.scrollHeight}px`
  }, [value])

  return canEdit ? (
    <textarea
      ref={taRef}
      rows={1}
      className={cn(
        'bg-transparent w-full focus:bg-zinc-800/80 rounded px-1.5 py-1 text-sm text-zinc-200 resize-none overflow-hidden',
        'placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors',
        className,
      )}
      value={value} placeholder={placeholder}
      onChange={e => {
        onChange(e.target.value)
        e.target.style.height = 'auto'
        e.target.style.height = `${e.target.scrollHeight}px`
      }}
      onBlur={e => onBlur(e.target.value)}
    />
  ) : (
    <span className={cn('text-sm text-zinc-300 whitespace-pre-wrap', className)}>
      {value || <span className="text-zinc-600">—</span>}
    </span>
  )
}

interface Props { productionId: string; canEdit: boolean }

export function BreakdownTab({ productionId, canEdit }: Props) {
  const { data: scenes } = useCollection<ProductionSceneDoc>(
    `productions/${productionId}/scenes`, [orderBy('sceneNumber', 'asc')],
  )
  const { data: cast } = useCollection<ProductionCastDoc>(
    `productions/${productionId}/cast`, [orderBy('castId', 'asc')],
  )
  const { data: locations } = useCollection<ProductionLocationDoc>(
    `productions/${productionId}/locations`, [orderBy('name', 'asc')],
  )

  const [edits,       setEdits]       = useState<Record<string, Record<string, any>>>({})
  const [castOpen,    setCastOpen]    = useState<string | null>(null)
  const [castPos,     setCastPos]     = useState<{ top: number; left: number } | null>(null)
  const [locOpen,     setLocOpen]     = useState<string | null>(null)
  const [locPos,      setLocPos]      = useState<{ top: number; left: number } | null>(null)
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set())
  const castBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const locBtnRefs  = useRef<Record<string, HTMLButtonElement | null>>({})

  function get(id: string, field: string, fallback: any) { return edits[id]?.[field] ?? fallback }
  function setLocal(id: string, field: string, value: any) {
    if (!canEdit) return
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }))
  }
  async function save(id: string, field: string, value: any) {
    if (!canEdit) return
    await updateDoc(doc(db, `productions/${productionId}/scenes`, id), {
      [field]: value, updatedAt: serverTimestamp(),
    })
    setEdits(prev => {
      const next = { ...prev }
      if (next[id]) {
        const { [field]: _, ...rest } = next[id]
        Object.keys(rest).length === 0 ? delete next[id] : (next[id] = rest)
      }
      return next
    })
  }
  async function toggle(id: string, field: 'dayNight' | 'intExt') {
    if (!canEdit) return
    const scene = scenes.find(s => s.id === id)
    if (!scene) return
    const newVal = field === 'dayNight'
      ? (scene.dayNight === 'Day' ? 'Night' : 'Day')
      : (scene.intExt === 'INT' ? 'EXT' : 'INT')
    await save(id, field, newVal)
  }
  async function toggleCastId(sceneId: string, castId: number) {
    if (!canEdit) return
    const scene = scenes.find(s => s.id === sceneId)
    if (!scene) return
    const current = scene.castIds ?? []
    const next = current.includes(castId)
      ? current.filter(c => c !== castId)
      : [...current, castId].sort((a, b) => a - b)
    await save(sceneId, 'castIds', next)
  }
  async function addScene() {
    const maxNum = scenes.reduce((m, s) => Math.max(m, s.sceneNumber), 0)
    await addDoc(collection(db, `productions/${productionId}/scenes`), {
      sceneNumber: maxNum + 1, dayNight: 'Day', intExt: 'INT',
      location: '', description: '', castIds: [], props: '', makeup: '', costume: '', notes: '',
    })
  }
  async function deleteScene(id: string) {
    if (!confirm('Delete this scene?')) return
    await deleteDoc(doc(db, `productions/${productionId}/scenes`, id))
  }
  async function moveScene(id: string, dir: 'up' | 'down') {
    if (!canEdit) return
    const idx = scenes.findIndex(s => s.id === id)
    const swap = dir === 'up' ? scenes[idx - 1] : scenes[idx + 1]
    if (!swap) return
    await Promise.all([
      updateDoc(doc(db, `productions/${productionId}/scenes`, id), { sceneNumber: swap.sceneNumber }),
      updateDoc(doc(db, `productions/${productionId}/scenes`, swap.id), { sceneNumber: scenes[idx].sceneNumber }),
    ])
  }

  function openCastDropdown(sceneId: string) {
    if (castOpen === sceneId) { setCastOpen(null); return }
    const btn = castBtnRefs.current[sceneId]
    if (btn) {
      const rect = btn.getBoundingClientRect()
      setCastPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX })
    }
    setCastOpen(sceneId)
  }

  function openLocDropdown(sceneId: string) {
    if (locOpen === sceneId) { setLocOpen(null); return }
    const btn = locBtnRefs.current[sceneId]
    if (btn) {
      const rect = btn.getBoundingClientRect()
      setLocPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX })
    }
    setLocOpen(sceneId)
  }

  async function selectLocation(sceneId: string, loc: ProductionLocationDoc) {
    setLocal(sceneId, 'location', loc.name)
    await save(sceneId, 'location', loc.name)
    await updateDoc(doc(db, `productions/${productionId}/scenes`, sceneId), { locationId: loc.id, updatedAt: serverTimestamp() })
    setLocOpen(null)
  }

  async function clearLocationLink(sceneId: string) {
    await updateDoc(doc(db, `productions/${productionId}/scenes`, sceneId), { locationId: null, updatedAt: serverTimestamp() })
  }

  function dnBadge(scene: ProductionSceneDoc) {
    return (
      <button disabled={!canEdit} onClick={() => toggle(scene.id, 'dayNight')}
        className={cn('text-xs font-bold px-1.5 py-0.5 rounded transition-colors',
          scene.dayNight === 'Night' ? 'bg-indigo-900/60 text-indigo-300' : 'bg-amber-900/40 text-amber-300',
          !canEdit && 'cursor-default')}
      >{scene.dayNight === 'Day' ? 'D' : 'N'}</button>
    )
  }
  function ieBadge(scene: ProductionSceneDoc) {
    return (
      <button disabled={!canEdit} onClick={() => toggle(scene.id, 'intExt')}
        className={cn('text-xs font-bold px-1.5 py-0.5 rounded transition-colors',
          scene.intExt === 'INT' ? 'bg-sky-900/50 text-sky-300' : 'bg-green-900/40 text-green-300',
          !canEdit && 'cursor-default')}
      >{scene.intExt}</button>
    )
  }

  function castCell(scene: ProductionSceneDoc) {
    const sel = scene.castIds ?? []
    return (
      <div className="flex flex-wrap gap-0.5 items-center">
        {sel.map(cid => (
          <span key={cid} className="text-[10px] bg-brand-900/50 text-brand-300 px-1 rounded font-mono">{cid}</span>
        ))}
        {canEdit && (
          <button
            ref={el => { castBtnRefs.current[scene.id] = el }}
            onClick={() => openCastDropdown(scene.id)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1 rounded border border-dashed border-zinc-700 hover:border-zinc-500"
          >{sel.length === 0 ? '+ cast' : '±'}</button>
        )}
      </div>
    )
  }

  const locDropdown = locOpen && locPos
    ? createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setLocOpen(null)} />
          <div
            className="fixed z-50 bg-zinc-800 border border-white/10 rounded-xl shadow-xl p-2 min-w-[240px]"
            style={{ top: locPos.top, left: locPos.left }}
          >
            <p className="text-xs text-zinc-500 px-2 pb-1.5 font-medium">Link location</p>
            {locations.length === 0
              ? <p className="text-xs text-zinc-500 px-2 py-1">Add locations in the Locations tab first</p>
              : locations.map(loc => (
                <button key={loc.id} onClick={() => selectLocation(locOpen!, loc)}
                  className="w-full text-left flex flex-col gap-0.5 px-2 py-2 hover:bg-zinc-700/50 rounded-lg">
                  <span className="text-sm text-zinc-200">{loc.name}</span>
                  {loc.address && <span className="text-xs text-zinc-500">{loc.address}</span>}
                </button>
              ))
            }
            {(() => {
              const scene = scenes.find(s => s.id === locOpen)
              return scene?.locationId ? (
                <button onClick={() => { clearLocationLink(locOpen!); setLocOpen(null) }}
                  className="w-full text-left px-2 py-1.5 mt-1 border-t border-white/10 text-xs text-zinc-500 hover:text-rose-400 transition-colors">
                  Remove location link
                </button>
              ) : null
            })()}
            <button onClick={() => setLocOpen(null)} className="w-full text-xs text-zinc-500 mt-1 hover:text-zinc-300 py-0.5 border-t border-white/10">Done</button>
          </div>
        </>,
        document.body,
      )
    : null

  // Cast dropdown rendered via portal so it's never clipped by overflow:auto
  const castDropdown = castOpen && castPos
    ? createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCastOpen(null)} />
          <div
            className="fixed z-50 bg-zinc-800 border border-white/10 rounded-xl shadow-xl p-2 min-w-[200px]"
            style={{ top: castPos.top, left: castPos.left }}
          >
            {cast.length === 0
              ? <p className="text-xs text-zinc-500 px-2 py-1">Add cast members first</p>
              : cast.map(c => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700/50 rounded cursor-pointer text-sm">
                  <input type="checkbox" checked={(scenes.find(s => s.id === castOpen)?.castIds ?? []).includes(c.castId)}
                    onChange={() => toggleCastId(castOpen!, c.castId)} className="accent-brand-500" />
                  <span className="text-zinc-400 font-mono text-xs w-4">{c.castId}</span>
                  <span className="text-zinc-200">{c.characterName}</span>
                </label>
              ))
            }
            <button onClick={() => setCastOpen(null)} className="w-full text-xs text-zinc-500 mt-1 hover:text-zinc-300 py-0.5 pt-2 border-t border-white/10">Done</button>
          </div>
        </>,
        document.body,
      )
    : null

  if (scenes.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-center py-12 text-zinc-500">
          <span className="text-3xl block mb-3">🎬</span>
          <p className="text-sm">No scenes yet. Add your first scene to start the breakdown.</p>
        </div>
        {canEdit && (
          <button onClick={addScene} className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors">
            <Plus className="w-4 h-4" /> Add Scene
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {castDropdown}
      {locDropdown}

      {/* ── Mobile card view (< md) ─────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {scenes.map(scene => {
          const bgKey = `${scene.intExt}-${scene.dayNight}`
          const isExpanded = expanded.has(scene.id)
          return (
            <div key={scene.id} className={cn('border rounded-2xl overflow-visible', SCENE_BG[bgKey] ?? 'bg-zinc-900/50 border-white/10')}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                {canEdit ? (
                  <input
                    className="w-8 bg-transparent text-xs font-mono text-zinc-400 text-center focus:bg-zinc-800/80 rounded px-1 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                    value={get(scene.id, 'sceneNumber', scene.sceneNumber)}
                    onChange={e => setLocal(scene.id, 'sceneNumber', e.target.value)}
                    onBlur={e => { const n = parseInt(e.target.value); if (!isNaN(n)) save(scene.id, 'sceneNumber', n) }}
                  />
                ) : (
                  <span className="text-xs font-mono text-zinc-400 w-6">{scene.sceneNumber}</span>
                )}
                {dnBadge(scene)}
                {ieBadge(scene)}
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <EditInput value={get(scene.id, 'location', scene.location)} placeholder="Location"
                    canEdit={canEdit} onChange={v => { setLocal(scene.id, 'location', v); if (scene.locationId) clearLocationLink(scene.id) }} onBlur={v => save(scene.id, 'location', v)} />
                  {canEdit && locations.length > 0 && (
                    <button ref={el => { locBtnRefs.current[scene.id] = el }} onClick={() => openLocDropdown(scene.id)}
                      className={cn('p-1 rounded flex-shrink-0 transition-colors', scene.locationId ? 'text-brand-400' : 'text-zinc-600 hover:text-brand-400')}>
                      <MapPin className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(scene.id) ? n.delete(scene.id) : n.add(scene.id); return n })}
                  className="p-1 text-zinc-500 hover:text-zinc-300 flex-shrink-0"
                ><ChevronRight className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-90')} /></button>
              </div>
              <div className="px-3 pb-2">
                <EditTextarea value={get(scene.id, 'description', scene.description)} placeholder="Scene description…"
                  className="text-zinc-400 text-xs" canEdit={canEdit}
                  onChange={v => setLocal(scene.id, 'description', v)} onBlur={v => save(scene.id, 'description', v)} />
              </div>
              {isExpanded && (
                <div className="border-t border-white/10 px-3 py-3 space-y-2.5">
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Pages</p>
                    {canEdit ? (
                      <select
                        className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                        value={scene.pages ?? ''}
                        onChange={e => save(scene.id, 'pages', e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">—</option>
                        {PAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-zinc-300">{scene.pages ? fmtPages(scene.pages) : '—'}</span>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Cast</p>
                    {castCell(scene)}
                  </div>
                  {(['props', 'makeup', 'costume'] as const).map(f => (
                    <div key={f}>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                        {f === 'makeup' ? 'Make-up' : f.charAt(0).toUpperCase() + f.slice(1)}
                      </p>
                      <EditInput value={get(scene.id, f, scene[f])} canEdit={canEdit}
                        onChange={v => setLocal(scene.id, f, v)} onBlur={v => save(scene.id, f, v)} />
                    </div>
                  ))}
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Notes</p>
                    <EditTextarea value={get(scene.id, 'notes', scene.notes)} canEdit={canEdit}
                      onChange={v => setLocal(scene.id, 'notes', v)} onBlur={v => save(scene.id, 'notes', v)} />
                  </div>
                  {canEdit && (
                    <button onClick={() => deleteScene(scene.id)}
                      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-rose-400 transition-colors mt-2">
                      <Trash2 className="w-3.5 h-3.5" /> Delete scene
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Desktop table view (>= md) ───────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse">
          <thead>
            <tr className="border-b border-white/10">
              {['#', 'D/N', 'I/E', 'Pages', 'Location', 'Description', 'Cast', 'Props', 'Make-up', 'Costume', 'Notes', ''].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-2 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene, i) => {
              const bgKey = `${scene.intExt}-${scene.dayNight}`
              return (
                <tr key={scene.id} className={cn('border-b border-white/5 group transition-colors', SCENE_BG[bgKey]?.split(' ')[0])}>
                  {/* Scene number — editable */}
                  <td className="px-2 py-1.5 w-12">
                    <div className="flex items-center gap-0.5">
                      {canEdit ? (
                        <input
                          className="w-7 bg-transparent text-xs font-mono text-zinc-400 text-center focus:bg-zinc-800/80 rounded px-0.5 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                          value={get(scene.id, 'sceneNumber', scene.sceneNumber)}
                          onChange={e => setLocal(scene.id, 'sceneNumber', e.target.value)}
                          onBlur={e => { const n = parseInt(e.target.value); if (!isNaN(n)) save(scene.id, 'sceneNumber', n) }}
                        />
                      ) : (
                        <span className="w-5 text-zinc-400 text-xs font-mono">{scene.sceneNumber}</span>
                      )}
                      {canEdit && (
                        <div className="hidden group-hover:flex flex-col">
                          <button onClick={() => moveScene(scene.id, 'up')} disabled={i === 0}
                            className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 leading-none">
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button onClick={() => moveScene(scene.id, 'down')} disabled={i === scenes.length - 1}
                            className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 leading-none">
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 w-10">{dnBadge(scene)}</td>
                  <td className="px-2 py-1.5 w-10">{ieBadge(scene)}</td>
                  {/* Pages */}
                  <td className="px-1 py-1 w-16">
                    {canEdit ? (
                      <select
                        className="bg-transparent w-full text-xs text-zinc-300 focus:bg-zinc-800/80 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                        value={scene.pages ?? ''}
                        onChange={e => save(scene.id, 'pages', e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">—</option>
                        {PAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-zinc-400 px-1">{scene.pages ? fmtPages(scene.pages) : '—'}</span>
                    )}
                  </td>
                  {/* Location */}
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-0.5">
                      <AutoInput
                        value={get(scene.id, 'location', scene.location ?? '')}
                        placeholder="Location"
                        minW="min-w-[100px]"
                        canEdit={canEdit}
                        onChange={v => { setLocal(scene.id, 'location', v); if (scene.locationId) clearLocationLink(scene.id) }}
                        onBlur={v => save(scene.id, 'location', v)}
                      />
                      {canEdit && locations.length > 0 && (
                        <button ref={el => { locBtnRefs.current[scene.id] = el }} onClick={() => openLocDropdown(scene.id)}
                          className={cn('p-0.5 rounded flex-shrink-0 transition-colors', scene.locationId ? 'text-brand-400' : 'text-zinc-700 hover:text-brand-400')}>
                          <MapPin className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  {/* Description */}
                  <td className="px-1 py-1">
                    <AutoTextarea value={get(scene.id, 'description', scene.description ?? '')} canEdit={canEdit} minW="min-w-[160px]"
                      onChange={v => setLocal(scene.id, 'description', v)} onBlur={v => save(scene.id, 'description', v)} />
                  </td>
                  {/* Cast */}
                  <td className="px-2 py-1.5">{castCell(scene)}</td>
                  {/* Props, Make-up, Costume */}
                  {(['props', 'makeup', 'costume'] as const).map(f => (
                    <td key={f} className="px-1 py-1">
                      <AutoInput value={get(scene.id, f, scene[f] ?? '')} canEdit={canEdit}
                        onChange={v => setLocal(scene.id, f, v)} onBlur={v => save(scene.id, f, v)} />
                    </td>
                  ))}
                  {/* Notes */}
                  <td className="px-1 py-1">
                    <AutoTextarea value={get(scene.id, 'notes', scene.notes ?? '')} canEdit={canEdit} minW="min-w-[110px]"
                      onChange={v => setLocal(scene.id, 'notes', v)} onBlur={v => save(scene.id, 'notes', v)} />
                  </td>
                  <td className="px-2 py-1.5 w-8">
                    {canEdit && (
                      <button onClick={() => deleteScene(scene.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 transition-all rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <button onClick={addScene} className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors">
          <Plus className="w-4 h-4" /> Add Scene
        </button>
      )}
    </div>
  )
}
