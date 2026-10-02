import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { doc, updateDoc, addDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { ProductionSceneDoc, ProductionCastDoc, ProductionLocationDoc, ProductionCostumeDoc, ProductionMakeupDoc, ProductionPropsDoc } from '@/types'
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, MapPin } from 'lucide-react'

type ItemField = 'costumeIds' | 'makeupIds' | 'propsIds'
const ITEM_KINDS: { field: ItemField; collectionName: string; label: string }[] = [
  { field: 'costumeIds', collectionName: 'costumes', label: 'Costume' },
  { field: 'makeupIds',  collectionName: 'makeup',   label: 'Make-up' },
  { field: 'propsIds',   collectionName: 'props',    label: 'Props' },
]

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

// Position + max-height for a portal-rendered picker dropdown, anchored to
// a trigger button. These panels use `position: fixed`, which is
// viewport-relative — unlike `position: absolute`, it must NOT be offset by
// window.scrollX/Y (that was the bug: on a scrolled-down page the panel
// opened far below the visible viewport, with no way to reach it even
// though its own content scrolled fine). This also flips the panel above
// the button and caps its height to whichever side has more room, so a
// long list (many cast/costume/location entries) always stays fully
// reachable on screen.
interface DropdownPos { left: number; top?: number; bottom?: number; maxHeight: number }

function computeDropdownPos(btn: HTMLElement, panelWidth = 240): DropdownPos {
  const rect   = btn.getBoundingClientRect()
  const margin = 8
  const spaceBelow = window.innerHeight - rect.bottom - margin
  const spaceAbove = rect.top - margin
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - panelWidth - margin))

  if (spaceBelow < 160 && spaceAbove > spaceBelow) {
    return { left, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(120, spaceAbove - 4) }
  }
  return { left, top: rect.bottom + 4, maxHeight: Math.max(120, spaceBelow - 4) }
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
  const { data: costumes } = useCollection<ProductionCostumeDoc>(
    `productions/${productionId}/costumes`, [orderBy('order', 'asc')],
  )
  const { data: makeupItems } = useCollection<ProductionMakeupDoc>(
    `productions/${productionId}/makeup`, [orderBy('order', 'asc')],
  )
  const { data: propsItems } = useCollection<ProductionPropsDoc>(
    `productions/${productionId}/props`, [orderBy('order', 'asc')],
  )
  const itemCollections: Record<ItemField, ProductionCostumeDoc[]> = {
    costumeIds: costumes, makeupIds: makeupItems, propsIds: propsItems,
  }

  const [edits,       setEdits]       = useState<Record<string, Record<string, any>>>({})
  const [castOpen,    setCastOpen]    = useState<string | null>(null)
  const [castPos,     setCastPos]     = useState<DropdownPos | null>(null)
  const [locOpen,     setLocOpen]     = useState<string | null>(null)
  const [locPos,      setLocPos]      = useState<DropdownPos | null>(null)
  const [itemPicker,    setItemPicker]    = useState<{ field: ItemField; sceneId: string } | null>(null)
  const [itemPickerPos, setItemPickerPos] = useState<DropdownPos | null>(null)
  const [revealedCast, setRevealedCast]   = useState<Set<string>>(new Set())
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set())
  const castBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const locBtnRefs  = useRef<Record<string, HTMLButtonElement | null>>({})
  const itemBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})

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
  async function toggleItemId(sceneId: string, field: ItemField, itemId: string) {
    if (!canEdit) return
    const scene = scenes.find(s => s.id === sceneId)
    if (!scene) return
    const current = (scene[field] as string[] | undefined) ?? []
    const next = current.includes(itemId) ? current.filter(x => x !== itemId) : [...current, itemId]
    await save(sceneId, field, next)
  }
  function toggleRevealCast(key: string) {
    setRevealedCast(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  async function addScene() {
    const maxNum = scenes.reduce((m, s) => Math.max(m, s.sceneNumber), 0)
    await addDoc(collection(db, `productions/${productionId}/scenes`), {
      sceneNumber: maxNum + 1, dayNight: 'Day', intExt: 'INT',
      location: '', description: '', castIds: [], costumeIds: [], makeupIds: [], propsIds: [], notes: '',
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
    if (btn) setCastPos(computeDropdownPos(btn, 200))
    setCastOpen(sceneId)
  }

  function openLocDropdown(sceneId: string) {
    if (locOpen === sceneId) { setLocOpen(null); return }
    const btn = locBtnRefs.current[sceneId]
    if (btn) setLocPos(computeDropdownPos(btn, 240))
    setLocOpen(sceneId)
  }

  function openItemPicker(field: ItemField, sceneId: string) {
    if (itemPicker?.field === field && itemPicker.sceneId === sceneId) { setItemPicker(null); return }
    const btn = itemBtnRefs.current[`${field}-${sceneId}`]
    if (btn) setItemPickerPos(computeDropdownPos(btn, 220))
    setItemPicker({ field, sceneId })
  }

  async function selectLocation(sceneId: string, loc: ProductionLocationDoc) {
    const scene = scenes.find(s => s.id === sceneId)
    // Only auto-fill from the location's own script name — never fall back to
    // the real place name, or the breakdown ends up showing the real location
    // instead of a script term. If the location has no script name recorded
    // yet, leave the field for the user to type themselves.
    if (scene && !scene.location?.trim() && loc.scriptName?.trim()) {
      setLocal(sceneId, 'location', loc.scriptName)
      await save(sceneId, 'location', loc.scriptName)
    }
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
        {sel.map(cid => {
          const key = `${scene.id}-${cid}`
          const revealed = revealedCast.has(key)
          const name = cast.find(c => c.castId === cid)?.characterName
          return (
            <button
              key={cid}
              type="button"
              title="Click to reveal character name"
              onClick={() => toggleRevealCast(key)}
              className="text-[10px] bg-brand-900/50 text-brand-300 px-1 rounded font-mono hover:bg-brand-800/70 transition-colors max-w-[90px] truncate"
            >{revealed && name ? name : cid}</button>
          )
        })}
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

  function itemCell(scene: ProductionSceneDoc, field: ItemField) {
    const items = itemCollections[field]
    const sel = (scene[field] as string[] | undefined) ?? []
    const selectedItems = sel.map(id => items.find(it => it.id === id)).filter(Boolean) as ProductionCostumeDoc[]
    const kindLabel = ITEM_KINDS.find(k => k.field === field)!.label.toLowerCase()
    return (
      <div className="flex flex-wrap gap-0.5 items-center">
        {selectedItems.map(it => (
          <span key={it.id} title={it.characterName} className="text-[10px] bg-zinc-800 text-zinc-300 px-1 rounded max-w-[90px] truncate">
            {it.characterName || '—'}
          </span>
        ))}
        {canEdit && (
          <button
            ref={el => { itemBtnRefs.current[`${field}-${scene.id}`] = el }}
            onClick={() => openItemPicker(field, scene.id)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1 rounded border border-dashed border-zinc-700 hover:border-zinc-500"
          >{sel.length === 0 ? `+ ${kindLabel}` : '±'}</button>
        )}
      </div>
    )
  }

  const locDropdown = locOpen && locPos
    ? createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setLocOpen(null)} />
          <div
            className="fixed z-50 bg-zinc-800 border border-white/10 rounded-xl shadow-xl p-2 min-w-[240px] overflow-y-auto"
            style={{ top: locPos.top, bottom: locPos.bottom, left: locPos.left, maxHeight: locPos.maxHeight }}
          >
            {(() => {
              const scene = scenes.find(s => s.id === locOpen)
              const linkedLoc = scene?.locationId ? locations.find(l => l.id === scene.locationId) : null
              if (!linkedLoc) return null
              const addr = [linkedLoc.address, linkedLoc.zipCode, linkedLoc.state].filter(Boolean).join(', ')
              return (
                <div className="px-2 pb-2 mb-1.5 border-b border-white/10">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Address</p>
                  <p className="text-sm text-zinc-200 font-medium">{linkedLoc.name}</p>
                  {addr && <p className="text-xs text-zinc-400 mt-0.5">{addr}</p>}
                </div>
              )
            })()}
            <p className="text-xs text-zinc-500 px-2 pb-1.5 font-medium">
              {scenes.find(s => s.id === locOpen)?.locationId ? 'Change location' : 'Link location'}
            </p>
            {locations.length === 0
              ? <p className="text-xs text-zinc-500 px-2 py-1">Add locations in the Locations tab first</p>
              : locations.map(loc => (
                <button key={loc.id} onClick={() => selectLocation(locOpen!, loc)}
                  className="w-full text-left flex flex-col gap-0.5 px-2 py-2 hover:bg-zinc-700/50 rounded-lg">
                  <span className="text-sm text-zinc-200">{loc.scriptName || loc.name}</span>
                  {(loc.name || loc.address) && (
                    <span className="text-xs text-zinc-500">{[loc.name, loc.address].filter(Boolean).join(' — ')}</span>
                  )}
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
            className="fixed z-50 bg-zinc-800 border border-white/10 rounded-xl shadow-xl p-2 min-w-[200px] overflow-y-auto"
            style={{ top: castPos.top, bottom: castPos.bottom, left: castPos.left, maxHeight: castPos.maxHeight }}
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

  // Costume/Make-up/Props picker — same pattern as cast, one shared portal
  const itemDropdown = itemPicker && itemPickerPos
    ? createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setItemPicker(null)} />
          <div
            className="fixed z-50 bg-zinc-800 border border-white/10 rounded-xl shadow-xl p-2 min-w-[220px] overflow-y-auto"
            style={{ top: itemPickerPos.top, bottom: itemPickerPos.bottom, left: itemPickerPos.left, maxHeight: itemPickerPos.maxHeight }}
          >
            {(() => {
              const { field, sceneId } = itemPicker
              const items = itemCollections[field]
              const kind = ITEM_KINDS.find(k => k.field === field)!
              const scene = scenes.find(s => s.id === sceneId)
              const sel = (scene?.[field] as string[] | undefined) ?? []
              return items.length === 0 ? (
                <p className="text-xs text-zinc-500 px-2 py-1">Add {kind.label.toLowerCase()} items in the {kind.label} tab first</p>
              ) : items.map(it => (
                <label key={it.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700/50 rounded cursor-pointer text-sm">
                  <input type="checkbox" checked={sel.includes(it.id)}
                    onChange={() => toggleItemId(sceneId, field, it.id)} className="accent-brand-500" />
                  <span className="text-zinc-200">{it.characterName || <span className="text-zinc-500">Untitled</span>}</span>
                </label>
              ))
            })()}
            <button onClick={() => setItemPicker(null)} className="w-full text-xs text-zinc-500 mt-1 hover:text-zinc-300 py-0.5 pt-2 border-t border-white/10">Done</button>
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
      {itemDropdown}

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
                    canEdit={canEdit} onChange={v => setLocal(scene.id, 'location', v)} onBlur={v => save(scene.id, 'location', v)} />
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
                  {ITEM_KINDS.map(k => (
                    <div key={k.field}>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{k.label}</p>
                      {itemCell(scene, k.field)}
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
              {['#', 'D/N', 'I/E', 'Pages', 'Location', 'Description', 'Cast', 'Costume', 'Make-up', 'Props', 'Notes', ''].map(h => (
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
                        onChange={v => setLocal(scene.id, 'location', v)}
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
                  {/* Costume, Make-up, Props */}
                  {ITEM_KINDS.map(k => (
                    <td key={k.field} className="px-2 py-1.5">{itemCell(scene, k.field)}</td>
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
