import { useState, useMemo, useEffect, useRef } from 'react'
import { doc, updateDoc, addDoc, deleteDoc, collection, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type {
  ProductionShootingDayDoc, ProductionSceneDoc, ProductionCastDoc, LocationMove,
  ProductionCrewAssignmentDoc, ProductionLocationDoc, CrewRoleDoc, ProductionShotDoc,
} from '@/types'
import { Plus, Trash2, CalendarDays, X, AlertTriangle, MapPin, Check, Clock, FileSpreadsheet, Loader2, Bell } from 'lucide-react'
import {
  CallSheetPreviewModal,
  parseTime as _parseTime, getStartEnd as _getStartEnd,
  shootDurationMinutes, normalizeToShootWindow, effectiveEndMinutes,
} from '@/components/production/CallSheetPreviewModal'
import { exportCallSheet, exportCallSheetPDF } from './scheduleExport'

const SCENE_STRIP_BG: Record<string, string> = {
  'INT-Day':   'bg-sky-900/40 border-sky-700/50',
  'EXT-Day':   'bg-amber-900/40 border-amber-700/50',
  'INT-Night': 'bg-indigo-900/50 border-indigo-700/50',
  'EXT-Night': 'bg-purple-900/50 border-purple-700/50',
}

interface Props {
  productionId: string
  canEdit: boolean
  productionTitle: string
}

const parseTime = _parseTime
const getStartEnd = _getStartEnd

// Auto-growing textarea — typing past the visible width wraps and grows the
// row instead of scrolling the text sideways out of view in a fixed-height
// <input>.
function AutoGrowInput({
  value, placeholder, className, onChange, onBlur,
}: {
  value: string; placeholder: string; className?: string
  onChange: (v: string) => void; onBlur: (v: string) => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!taRef.current) return
    taRef.current.style.height = 'auto'
    taRef.current.style.height = `${taRef.current.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={taRef}
      rows={1}
      className={cn(className, 'resize-none overflow-hidden')}
      value={value}
      placeholder={placeholder}
      onChange={e => {
        onChange(e.target.value)
        e.target.style.height = 'auto'
        e.target.style.height = `${e.target.scrollHeight}px`
      }}
      onBlur={e => onBlur(e.target.value)}
    />
  )
}

// ── LocationMoveCard ──────────────────────────────────────────────────────────
function LocationMoveCard({ move, canEdit, onEdit, onDelete }: {
  move: LocationMove; canEdit: boolean; onEdit: () => void; onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-xs group/move">
      <MapPin className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
      <span className="font-semibold text-amber-300">Location Move</span>
      <span className="text-amber-400/80">·</span>
      <span className="text-amber-300/90">{move.minutes} min</span>
      {move.note && (<><span className="text-amber-400/80">·</span><span className="text-amber-200/70 italic truncate flex-1">{move.note}</span></>)}
      {!move.note && <span className="flex-1" />}
      {canEdit && (
        <div className="flex items-center gap-1 opacity-0 group-hover/move:opacity-100 transition-opacity">
          <button onClick={onEdit}   className="p-1 text-amber-600 hover:text-amber-300 transition-colors rounded"><Clock className="w-3 h-3" /></button>
          <button onClick={onDelete} className="p-1 text-amber-700 hover:text-rose-400 transition-colors rounded"><X className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  )
}

// ── MoveForm ──────────────────────────────────────────────────────────────────
function MoveForm({ initialMinutes = '', initialNote = '', onSave, onCancel }: {
  initialMinutes?: string; initialNote?: string
  onSave: (minutes: number, note: string) => void; onCancel: () => void
}) {
  const [minutes, setMinutes] = useState(initialMinutes)
  const [note,    setNote]    = useState(initialNote)
  function submit() { const m = parseInt(minutes); if (!m || m <= 0) return; onSave(m, note.trim()) }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-800/40">
      <MapPin className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
      <input autoFocus type="number" min={1}
        className="w-16 bg-zinc-800 border border-white/10 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
        placeholder="min" value={minutes} onChange={e => setMinutes(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
      />
      <span className="text-xs text-zinc-500">min</span>
      <input
        className="flex-1 bg-zinc-800 border border-white/10 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
        placeholder="Note (optional, e.g. to Trollhättan)…" value={note} onChange={e => setNote(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
      />
      <button onClick={submit}   className="p-1.5 text-emerald-400 hover:text-emerald-300 transition-colors"><Check className="w-3.5 h-3.5" /></button>
      <button onClick={onCancel} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}

// ── ScheduleTab ───────────────────────────────────────────────────────────────
export function ScheduleTab({ productionId, canEdit, productionTitle }: Props) {
  const { data: days } = useCollection<ProductionShootingDayDoc>(
    `productions/${productionId}/shootingDays`, [orderBy('dayNumber', 'asc')],
  )
  const { data: scenes } = useCollection<ProductionSceneDoc>(
    `productions/${productionId}/scenes`, [orderBy('sceneNumber', 'asc')],
  )
  const { data: allCast } = useCollection<ProductionCastDoc>(
    `productions/${productionId}/cast`, [orderBy('castId', 'asc')],
  )
  const { data: allCrew } = useCollection<ProductionCrewAssignmentDoc>(
    `productions/${productionId}/crew`,
  )
  const { data: crewRoles } = useCollection<CrewRoleDoc>(
    'crew_roles', [orderBy('order', 'asc')],
  )
  const { data: locations } = useCollection<ProductionLocationDoc>(
    `productions/${productionId}/locations`, [orderBy('name', 'asc')],
  )
  const { data: shots } = useCollection<ProductionShotDoc>(
    `productions/${productionId}/shots`,
  )

  const [edits,           setEdits]           = useState<Record<string, Record<string, string>>>({})
  const [addToDay,        setAddToDay]        = useState<string | null>(null)
  const [addMoveKey,      setAddMoveKey]      = useState<string | null>(null)
  const [editMoveKey,     setEditMoveKey]     = useState<string | null>(null)
  const [exportingDayId,  setExportingDayId]  = useState<string | null>(null)
  const [previewDay,      setPreviewDay]      = useState<ProductionShootingDayDoc | null>(null)
  const [crewNotifyKey,   setCrewNotifyKey]   = useState<string | null>(null)
  const [notifyingCrew,   setNotifyingCrew]   = useState(false)
  const [draggingSceneId, setDraggingSceneId] = useState<string | null>(null)
  const [dragOverDayId,   setDragOverDayId]   = useState<string | null>(null)
  const [sunriseSunset, setSunriseSunset] = useState<Record<string, {
    sunrise: string; sunset: string; weather?: string; temp?: string
  } | null>>({})
  const [productionSettings, setProductionSettings] = useState({ maxHoursPerDay: 8, maxShotsPerDay: 25 })

  useEffect(() => {
    getDoc(doc(db, 'settings', 'production')).then(snap => {
      if (snap.exists()) setProductionSettings(snap.data() as any)
    })
  }, [])

  // ── Sunrise/sunset + weather fetch ───────────────────────────────────────
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])

  const WMO: Record<number, string> = {
    0: 'Clear', 1: 'Clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Fog',
    51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle',
    61: 'Rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Snow', 73: 'Snow', 75: 'Heavy snow',
    80: 'Showers', 81: 'Showers', 82: 'Showers',
    95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Hail',
  }

  useEffect(() => {
    const controller = new AbortController()
    // Shared across all days in this effect run, so we only prompt for the
    // browser's location once even if several days have no location set.
    let currentPosPromise: Promise<{ lat: number; lon: number } | null> | null = null
    function getCurrentPos(): Promise<{ lat: number; lon: number } | null> {
      if (!currentPosPromise) {
        currentPosPromise = new Promise(resolve => {
          if (!navigator.geolocation) { resolve(null); return }
          navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => resolve(null),
            { timeout: 8000, maximumAge: 600000 },
          )
        })
      }
      return currentPosPromise
    }
    async function fetchForDay(day: ProductionShootingDayDoc) {
      if (!day.date) return
      const daySceneIds = day.sceneIds ?? []
      const dayScenes   = scenes.filter(s => daySceneIds.includes(s.id))
      // Build a geocode query: prefer structured address fields, fall back to
      // location name, then scene location text
      const firstLocId = dayScenes.map(s => s.locationId).find(Boolean)
      const loc = firstLocId ? locById[firstLocId] : null
      const addrQuery = (
        [loc?.address, loc?.zipCode, loc?.state].filter(Boolean).join(' ') ||
        loc?.name ||
        dayScenes.map(s => s.location).find(Boolean) ||
        ''
      ).trim()
      try {
        // 1. Geocode — or, if no location is set for this day, fall back to
        // the browser's current position
        let lat: number | string, lon: number | string
        if (addrQuery) {
          const geoRes  = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addrQuery)}&format=json&limit=1`,
            { signal: controller.signal },
          )
          const geoData = await geoRes.json()
          if (!geoData.length) return
          ;({ lat, lon } = geoData[0])
        } else {
          const pos = await getCurrentPos()
          if (!pos) return
          lat = pos.lat
          lon = pos.lon
        }

        // 2. Sunrise / sunset
        const ssRes  = await fetch(
          `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${day.date}&formatted=0`,
          { signal: controller.signal },
        )
        const ssData = await ssRes.json()
        const fmt    = (iso: string) =>
          new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' })
        const sunrise = ssData.status === 'OK' ? fmt(ssData.results.sunrise) : '—'
        const sunset  = ssData.status === 'OK' ? fmt(ssData.results.sunset)  : '—'

        // 3. Weather (Open-Meteo — archive for past, forecast for future)
        // Uses hourly data so we can average only the actual shooting hours
        let weather: string | undefined
        let temp: string | undefined
        try {
          const isPast = new Date(day.date + 'T12:00:00') < new Date()
          const wxBase = isPast
            ? 'https://archive-api.open-meteo.com/v1/archive'
            : 'https://api.open-meteo.com/v1/forecast'

          // Daily call — reliable on both archive and forecast APIs
          const wxRes  = await fetch(
            `${wxBase}?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&start_date=${day.date}&end_date=${day.date}&timezone=Europe/Stockholm`,
            { signal: controller.signal },
          )
          const wxData = await wxRes.json()
          const code = wxData?.daily?.weathercode?.[0]
          const tMax = wxData?.daily?.temperature_2m_max?.[0]
          const tMin = wxData?.daily?.temperature_2m_min?.[0]
          if (code !== undefined) weather = WMO[code] ?? `Code ${code}`
          if (tMax !== undefined && tMin !== undefined)
            temp = `${Math.round((tMax + tMin) / 2)}°C`

          // Separate hourly call for shooting-hours average temp (overrides daily if it succeeds)
          const { startTime: dayStart, endTime: dayEnd } = getStartEnd(day)
          const startMin = parseTime(dayStart)
          const endMin   = parseTime(dayEnd)
          if (startMin !== null && endMin !== null) {
            try {
              // An overnight shoot (end time < start time, e.g. 19:00–01:00)
              // needs the next calendar day's hourly data too, or the hours
              // after midnight are simply missing from a single-day query.
              const isOvernight = endMin < startMin
              const wxEndDate = isOvernight
                ? (() => { const d = new Date(day.date + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })()
                : day.date
              const effEnd = effectiveEndMinutes(startMin, endMin)
              const hrRes  = await fetch(
                `${wxBase}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&start_date=${day.date}&end_date=${wxEndDate}&timezone=Europe/Stockholm`,
                { signal: controller.signal },
              )
              const hrData = await hrRes.json()
              const times: string[] = hrData?.hourly?.time ?? []
              const temps: number[] = hrData?.hourly?.temperature_2m ?? []
              const filtered = times.reduce<number[]>((acc, t, i) => {
                const [datePart, timePart] = t.split('T')
                const h = parseInt(timePart ?? '0')
                const minuteOfTimeline = (datePart === day.date ? 0 : 1440) + h * 60
                if (minuteOfTimeline >= startMin && minuteOfTimeline < effEnd && temps[i] != null) acc.push(temps[i])
                return acc
              }, [])
              if (filtered.length > 0)
                temp = `${Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length)}°C`
            } catch { /* keep daily temp fallback */ }
          }
        } catch { /* weather is optional */ }

        setSunriseSunset(prev => ({
          ...prev,
          [day.id]: { sunrise, sunset, weather, temp },
        }))
      } catch (e: any) {
        if (e.name !== 'AbortError') console.warn('Sunrise/sunset fetch failed', e)
      }
    }
    days.forEach(fetchForDay)
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    days.map(d => d.id + ':' + d.date + ':' + d.startTime + ':' + d.endTime + ':' + (d.sceneIds ?? []).join()).join('|'),
    scenes.map(s => s.id + ':' + (s.locationId ?? '')).join('|'),
    locations.map(l => l.id + ':' + [l.address, l.zipCode, l.state].join()).join('|'),
  ])

  function get(id: string, field: string, fallback: string) {
    return edits[id]?.[field] ?? fallback
  }
  function setLocal(id: string, field: string, value: string) {
    if (!canEdit) return
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }))
  }
  async function saveDay(id: string, field: string, value: string | number | null) {
    if (!canEdit) return
    await updateDoc(doc(db, `productions/${productionId}/shootingDays`, id), { [field]: value })
    setEdits(prev => {
      const next = { ...prev }
      if (next[id]) {
        const { [field]: _, ...rest } = next[id]
        Object.keys(rest).length === 0 ? delete next[id] : (next[id] = rest)
      }
      return next
    })
  }

  async function addDay() {
    const maxNum = days.reduce((m, d) => Math.max(m, d.dayNumber), 0)
    await addDoc(collection(db, `productions/${productionId}/shootingDays`), {
      dayNumber: maxNum + 1, date: '', workHours: '', startTime: '08:00', endTime: '17:00',
      rtsTime: '', sceneIds: [], notes: '', locationMoves: [],
    })
  }
  async function deleteDay(id: string) {
    if (!confirm('Delete this shooting day?')) return
    await deleteDoc(doc(db, `productions/${productionId}/shootingDays`, id))
  }
  async function addSceneToDay(dayId: string, sceneId: string) {
    await updateDoc(doc(db, `productions/${productionId}/shootingDays`, dayId), { sceneIds: arrayUnion(sceneId) })
    setAddToDay(null)
  }
  async function removeSceneFromDay(dayId: string, sceneId: string) {
    if (!canEdit) return
    await updateDoc(doc(db, `productions/${productionId}/shootingDays`, dayId), { sceneIds: arrayRemove(sceneId) })
  }

  async function saveLocationMove(dayId: string, afterSceneId: string, minutes: number, note: string) {
    const day = days.find(d => d.id === dayId)
    if (!day) return
    const existing = (day.locationMoves ?? []).filter(m => m.afterSceneId !== afterSceneId)
    await updateDoc(doc(db, `productions/${productionId}/shootingDays`, dayId), {
      locationMoves: [...existing, { id: `${afterSceneId}_${Date.now()}`, afterSceneId, minutes, note: note || undefined }],
    })
    setAddMoveKey(null)
  }
  async function updateLocationMove(dayId: string, moveId: string, minutes: number, note: string) {
    const day = days.find(d => d.id === dayId)
    if (!day) return
    await updateDoc(doc(db, `productions/${productionId}/shootingDays`, dayId), {
      locationMoves: (day.locationMoves ?? []).map(m => m.id === moveId ? { ...m, minutes, note: note || undefined } : m),
    })
    setEditMoveKey(null)
  }
  async function deleteLocationMove(dayId: string, moveId: string) {
    const day = days.find(d => d.id === dayId)
    if (!day) return
    await updateDoc(doc(db, `productions/${productionId}/shootingDays`, dayId), {
      locationMoves: (day.locationMoves ?? []).filter(m => m.id !== moveId),
    })
  }

  async function doDownload(day: ProductionShootingDayDoc) {
    const dayScenes = (day.sceneIds ?? []).map(sid => scenes.find(s => s.id === sid)).filter(Boolean) as ProductionSceneDoc[]
    setPreviewDay(null)
    setExportingDayId(day.id)
    try {
      await exportCallSheet(
        productionTitle, day, day.dayNumber, days.length,
        dayScenes, allCast, allCrew, crewRoles, locations, shots,
        sunriseSunset[day.id] ?? undefined,
      )
      setCrewNotifyKey(day.id)
    } finally {
      setExportingDayId(null)
    }
  }

  async function doDownloadPDF(day: ProductionShootingDayDoc) {
    const dayScenes = (day.sceneIds ?? []).map(sid => scenes.find(s => s.id === sid)).filter(Boolean) as ProductionSceneDoc[]
    setPreviewDay(null)
    setExportingDayId(day.id)
    try {
      await exportCallSheetPDF(
        productionTitle, day, day.dayNumber, days.length,
        dayScenes, allCast, allCrew, crewRoles, locations, shots,
        sunriseSunset[day.id] ?? undefined,
      )
    } finally {
      setExportingDayId(null)
    }
  }

  async function notifyCrew(day: ProductionShootingDayDoc) {
    setNotifyingCrew(true)
    try {
      const dateLabel = day.date
        ? new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        : `Day ${day.dayNumber}`
      const rts = day.rtsTime || getStartEnd(day).startTime || ''
      await addDoc(collection(db, `productions/${productionId}/crew_notifications`), {
        type: 'call_sheet',
        message: `${productionTitle} — Call Sheet for ${dateLabel} is ready.${rts ? ` RTS: ${rts}` : ''}`,
        dayId: day.id,
        date: day.date ?? '',
        rts,
        createdAt: new Date().toISOString(),
      })
      setCrewNotifyKey(null)
    } finally {
      setNotifyingCrew(false)
    }
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  const durationWarnings = useMemo(() => {
    const result: Record<string, number | null> = {}
    for (const day of days) {
      const { startTime, endTime } = getStartEnd(day)
      const s = parseTime(get(day.id, 'startTime', startTime))
      const e = parseTime(get(day.id, 'endTime', endTime))
      if (s === null || e === null) { result[day.id] = null; continue }
      const lunchMin = Number(get(day.id, 'lunchDuration', day.lunchDuration != null ? String(day.lunchDuration) : '0')) || 0
      result[day.id] = (shootDurationMinutes(s, e) - lunchMin) / 60
    }
    return result
  }, [days, edits])

  const restWarnings = useMemo(() => {
    const result: Record<string, number> = {}
    const withDate    = [...days].filter(d => get(d.id, 'date', d.date))
    const withoutDate = [...days].filter(d => !get(d.id, 'date', d.date))
    withDate.sort((a, b) => {
      const aD = get(a.id, 'date', a.date), bD = get(b.id, 'date', b.date)
      if (aD !== bD) return aD.localeCompare(bD)
      return get(a.id, 'startTime', getStartEnd(a).startTime).localeCompare(get(b.id, 'startTime', getStartEnd(b).startTime))
    })
    withoutDate.sort((a, b) => a.dayNumber - b.dayNumber)
    for (let i = 1; i < withDate.length; i++) {
      const prev = withDate[i - 1], curr = withDate[i]
      const prevEnd   = get(prev.id, 'endTime',   getStartEnd(prev).endTime)
      const currStart = get(curr.id, 'startTime', getStartEnd(curr).startTime)
      const prevDate  = get(prev.id, 'date', prev.date)
      const currDate  = get(curr.id, 'date', curr.date)
      if (!prevEnd || !currStart) continue
      result[curr.id] = (new Date(`${currDate}T${currStart}:00`).getTime() - new Date(`${prevDate}T${prevEnd}:00`).getTime()) / 3600000
    }
    for (let i = 1; i < withoutDate.length; i++) {
      const prev = withoutDate[i - 1], curr = withoutDate[i]
      if (curr.dayNumber !== prev.dayNumber + 1) continue
      const pM = parseTime(get(prev.id, 'endTime', getStartEnd(prev).endTime))
      const cM = parseTime(get(curr.id, 'startTime', getStartEnd(curr).startTime))
      if (pM === null || cM === null) continue
      result[curr.id] = (cM + 1440 - pM) / 60
    }
    return result
  }, [days, edits])

  const timeWarnings = useMemo(() => {
    const result: Record<string, { rtsOutOfRange: boolean; lunchOutOfRange: boolean; lunchLate: boolean }> = {}
    for (const day of days) {
      const { startTime, endTime } = getStartEnd(day)
      const s = parseTime(get(day.id, 'startTime', startTime))
      const e = parseTime(get(day.id, 'endTime', endTime))
      const eEff = s !== null && e !== null ? effectiveEndMinutes(s, e) : null
      const rtsRaw        = parseTime(get(day.id, 'rtsTime', day.rtsTime ?? ''))
      const lunchStartRaw = parseTime(get(day.id, 'lunchStart', day.lunchStart ?? ''))
      // Overnight shoot (e.g. 19:00–01:00): an RTS/lunch time after midnight
      // reads numerically smaller than the start time, even though it falls
      // inside the window — normalize it onto the same timeline first.
      const rts        = rtsRaw        !== null && s !== null && e !== null ? normalizeToShootWindow(rtsRaw, s, e)        : rtsRaw
      const lunchStart = lunchStartRaw !== null && s !== null && e !== null ? normalizeToShootWindow(lunchStartRaw, s, e) : lunchStartRaw
      result[day.id] = {
        rtsOutOfRange:   rts !== null && s !== null && eEff !== null && (rts < s || rts > eEff),
        lunchOutOfRange: lunchStart !== null && s !== null && eEff !== null && (lunchStart < s || lunchStart > eEff),
        lunchLate:       lunchStart !== null && s !== null && (lunchStart - s) > 240,
      }
    }
    return result
  }, [days, edits])

  const scheduledIds = new Set(days.flatMap(d => d.sceneIds ?? []))
  const unscheduled  = scenes.filter(s => !scheduledIds.has(s.id))

  function SceneStrip({ scene, dayId }: { scene: ProductionSceneDoc; dayId?: string }) {
    const key = `${scene.intExt}-${scene.dayNight}`
    const linkedLoc = scene.locationId ? locById[scene.locationId] : null
    const isDraggable = canEdit && !dayId
    const isDragging  = draggingSceneId === scene.id
    return (
      <div
        draggable={isDraggable}
        onDragStart={isDraggable ? e => { e.dataTransfer.effectAllowed = 'move'; setDraggingSceneId(scene.id) } : undefined}
        onDragEnd={isDraggable ? () => { setDraggingSceneId(null); setDragOverDayId(null) } : undefined}
        className={cn(
          'flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium group/strip',
          SCENE_STRIP_BG[key] ?? 'bg-zinc-800/60 border-white/10',
          isDraggable && 'cursor-grab active:cursor-grabbing',
          isDragging  && 'opacity-40',
        )}
      >
        <span className="font-mono text-zinc-300 w-5 flex-shrink-0 mt-0.5">{scene.sceneNumber}</span>
        <span className={cn('px-1 rounded text-[10px] font-bold flex-shrink-0 mt-0.5', scene.intExt === 'INT' ? 'bg-sky-900/60 text-sky-300' : 'bg-green-900/50 text-green-300')}>{scene.intExt}</span>
        <span className={cn('px-1 rounded text-[10px] font-bold flex-shrink-0 mt-0.5', scene.dayNight === 'Night' ? 'bg-indigo-900/60 text-indigo-300' : 'bg-amber-900/40 text-amber-300')}>{scene.dayNight === 'Day' ? 'D' : 'N'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-zinc-300 truncate">{scene.location || scene.description || '—'}</div>
          {linkedLoc && [linkedLoc.address, linkedLoc.zipCode, linkedLoc.state].filter(Boolean).length > 0 && (
            <div className="text-zinc-500 text-[10px] truncate mt-0.5">
              {[linkedLoc.address, linkedLoc.zipCode, linkedLoc.state].filter(Boolean).join(', ')}
            </div>
          )}
        </div>
        {dayId && canEdit && (
          <button onClick={() => removeSceneFromDay(dayId, scene.id)} className="opacity-0 group-hover/strip:opacity-100 text-zinc-500 hover:text-rose-400 transition-all flex-shrink-0 mt-0.5">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {unscheduled.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-400">Unscheduled Scenes</h3>
            {canEdit && <span className="text-[10px] text-zinc-600">drag into a day below</span>}
          </div>
          <div className={cn('bg-zinc-900/50 border border-white/10 rounded-xl p-3 flex flex-wrap gap-2 transition-colors', draggingSceneId && 'border-brand-700/50')}>
            {unscheduled.map(s => <SceneStrip key={s.id} scene={s} />)}
          </div>
        </div>
      )}
      {scenes.length === 0 && (
        <div className="text-center py-8 text-zinc-500 text-sm">Add scenes in the Script Breakdown tab first.</div>
      )}

      <div className="space-y-4">
        {days.map(day => {
          const dayScenes = (day.sceneIds ?? []).map(sid => scenes.find(s => s.id === sid)).filter(Boolean) as ProductionSceneDoc[]
          const availableToAdd = unscheduled.filter(s => !(day.sceneIds ?? []).includes(s.id))
          const { startTime: fallbackStart, endTime: fallbackEnd } = getStartEnd(day)
          const duration     = durationWarnings[day.id]
          const restBefore   = restWarnings[day.id]
          const maxHours     = productionSettings.maxHoursPerDay
          const tooLong      = duration !== null && duration > maxHours
          const tooShortRest = restBefore !== undefined && restBefore < 11
          const daySceneIds2 = new Set(day.sceneIds ?? [])
          const totalShots   = shots.filter(s => daySceneIds2.has(s.sceneId)).length
          const tooManyShots = totalShots > productionSettings.maxShotsPerDay
          const timeW        = timeWarnings[day.id]
          const movesMap     = Object.fromEntries((day.locationMoves ?? []).map(m => [m.afterSceneId, m]))
          const ss           = sunriseSunset[day.id]

          return (
            <div key={day.id} className="bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden">
              {/* Day header */}
              <div className="px-4 py-3 border-b border-white/10">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-brand-400">
                    <CalendarDays className="w-4 h-4 flex-shrink-0" />
                    <span className="font-semibold text-sm">Day {day.dayNumber}</span>
                    {duration !== null && <span className="text-xs text-zinc-500 font-normal">{duration.toFixed(1)}h</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{dayScenes.length} scene{dayScenes.length !== 1 ? 's' : ''}</span>
                    {totalShots > 0 && (
                      <span className={cn('text-xs', tooManyShots ? 'text-amber-400 font-semibold' : 'text-zinc-500')}>
                        {totalShots} shot{totalShots !== 1 ? 's' : ''}{tooManyShots ? ' ⚠' : ''}
                      </span>
                    )}
                    {canEdit && <button onClick={() => deleteDay(day.id)} className="p-1 text-zinc-500 hover:text-rose-400 transition-colors rounded"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
                {ss && (
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="flex items-center gap-1 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 rounded-lg px-2.5 py-1">
                      🌅 <span className="font-semibold">{ss.sunrise}</span> <span className="text-amber-500/70 text-[10px]">sunrise</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-sky-300 bg-sky-950/40 border border-sky-800/40 rounded-lg px-2.5 py-1">
                      🌇 <span className="font-semibold">{ss.sunset}</span> <span className="text-sky-500/70 text-[10px]">sunset</span>
                    </span>
                    {(ss.weather || ss.temp) && (
                      <span className="flex items-center gap-1 text-xs text-zinc-300 bg-zinc-800/60 border border-white/10 rounded-lg px-2.5 py-1">
                        🌤 {ss.weather}{ss.temp && <span className="ml-1 font-semibold text-zinc-200">{ss.temp}</span>}
                      </span>
                    )}
                  </div>
                )}

                {canEdit ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative w-full sm:w-36">
                        {!get(day.id, 'date', day.date) && (
                          <span className="absolute inset-0 flex items-center px-2 text-xs text-zinc-500 pointer-events-none z-10">Select date</span>
                        )}
                        <input type="date"
                          className={cn('bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-full [color-scheme:dark]', get(day.id, 'date', day.date) ? 'text-zinc-200' : 'text-transparent')}
                          value={get(day.id, 'date', day.date)}
                          onChange={e => setLocal(day.id, 'date', e.target.value)}
                          onBlur={e => saveDay(day.id, 'date', e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input type="time" className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-24 [color-scheme:dark]"
                          value={get(day.id, 'startTime', day.startTime ?? '')}
                          onChange={e => setLocal(day.id, 'startTime', e.target.value)}
                          onBlur={e => saveDay(day.id, 'startTime', e.target.value)} />
                        <span className="text-zinc-600 text-xs">–</span>
                        <input type="time" className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-24 [color-scheme:dark]"
                          value={get(day.id, 'endTime', day.endTime ?? '')}
                          onChange={e => setLocal(day.id, 'endTime', e.target.value)}
                          onBlur={e => saveDay(day.id, 'endTime', e.target.value)} />
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-emerald-500 tracking-widest w-8 flex-shrink-0">RTS</span>
                        <input type="time" className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 w-24 [color-scheme:dark]"
                          value={get(day.id, 'rtsTime', day.rtsTime ?? '')}
                          onChange={e => setLocal(day.id, 'rtsTime', e.target.value)}
                          onBlur={e => saveDay(day.id, 'rtsTime', e.target.value)} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-amber-400 tracking-widest w-12 flex-shrink-0">LUNCH</span>
                        <input type="time" className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500/30 w-24 [color-scheme:dark]"
                          placeholder="Start"
                          value={get(day.id, 'lunchStart', day.lunchStart ?? '')}
                          onChange={e => setLocal(day.id, 'lunchStart', e.target.value)}
                          onBlur={e => saveDay(day.id, 'lunchStart', e.target.value)} />
                        <input type="number" min={0} step={5}
                          className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500/30 w-16 [color-scheme:dark]"
                          placeholder="min"
                          value={get(day.id, 'lunchDuration', day.lunchDuration != null ? String(day.lunchDuration) : '')}
                          onChange={e => setLocal(day.id, 'lunchDuration', e.target.value)}
                          onBlur={e => saveDay(day.id, 'lunchDuration', e.target.value ? Number(e.target.value) : '')} />
                        <span className="text-[10px] text-zinc-500">min</span>
                      </div>
                      <AutoGrowInput
                        className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-full sm:flex-1"
                        value={get(day.id, 'notes', day.notes)} placeholder="Day notes…"
                        onChange={v => setLocal(day.id, 'notes', v)}
                        onBlur={v => saveDay(day.id, 'notes', v)} />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                    {day.date && <span>{new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>}
                    {(fallbackStart || fallbackEnd) && <span>⏱ {fallbackStart}–{fallbackEnd}</span>}
                    {!fallbackStart && day.workHours && <span>⏱ {day.workHours}</span>}
                    {day.rtsTime && <span className="text-emerald-400 font-semibold">RTS {day.rtsTime}</span>}
                    {day.lunchStart && <span className="text-amber-400/70">Lunch {day.lunchStart}{day.lunchDuration ? ` (${day.lunchDuration} min)` : ''}</span>}
                    {day.notes && <span className="italic text-zinc-500">{day.notes}</span>}
                  </div>
                )}

                {tooShortRest && (
                  <div className="mt-2 flex items-start gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>Less than 11 hours rest since the previous shooting day ({restBefore!.toFixed(1)}h). Crew need at least 11 hours between working days.</span>
                  </div>
                )}
                {tooLong && (
                  <div className="mt-2 flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>Shooting day is {duration!.toFixed(1)} hours — exceeds the {maxHours}h limit. Consider splitting scenes across multiple days.</span>
                  </div>
                )}
                {timeW?.rtsOutOfRange && (
                  <div className="mt-2 flex items-start gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>RTS is outside the day's start/end time.</span>
                  </div>
                )}
                {timeW?.lunchOutOfRange && (
                  <div className="mt-2 flex items-start gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>Lunch is outside the day's start/end time.</span>
                  </div>
                )}
                {timeW?.lunchLate && (
                  <div className="mt-2 flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>Lunch is more than 4 hours after start time — you're required to plan a break after 4 hours of working.</span>
                  </div>
                )}
                {tooManyShots && (
                  <div className="mt-2 flex items-start gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{totalShots} shots planned — exceeds the recommended {productionSettings.maxShotsPerDay} shots/day.</span>
                  </div>
                )}
              </div>

              {/* Scene list + location moves */}
              <div
                className={cn('p-3 space-y-1.5 transition-colors', dragOverDayId === day.id && 'bg-brand-900/20')}
                onDragOver={canEdit && draggingSceneId ? e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverDayId(day.id) } : undefined}
                onDragLeave={canEdit ? e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDayId(null) } : undefined}
                onDrop={canEdit && draggingSceneId ? e => {
                  e.preventDefault()
                  const sceneId = draggingSceneId
                  setDraggingSceneId(null)
                  setDragOverDayId(null)
                  addSceneToDay(day.id, sceneId)
                } : undefined}
              >
                {/* Move before first scene */}
                {(() => {
                  const move = movesMap['__start__']
                  const key  = `${day.id}::__start__`
                  if (editMoveKey === `${day.id}::${move?.id}`)
                    return <MoveForm initialMinutes={String(move!.minutes)} initialNote={move!.note ?? ''} onSave={(m, n) => updateLocationMove(day.id, move!.id, m, n)} onCancel={() => setEditMoveKey(null)} />
                  if (move)
                    return <LocationMoveCard move={move} canEdit={canEdit} onEdit={() => setEditMoveKey(`${day.id}::${move.id}`)} onDelete={() => deleteLocationMove(day.id, move.id)} />
                  if (addMoveKey === key)
                    return <MoveForm onSave={(m, n) => saveLocationMove(day.id, '__start__', m, n)} onCancel={() => setAddMoveKey(null)} />
                  return null
                })()}

                {dayScenes.map((scene, idx) => (
                  <div key={scene.id} className="space-y-1.5">
                    <SceneStrip scene={scene} dayId={day.id} />
                    {(() => {
                      const move = movesMap[scene.id]
                      const key  = `${day.id}::${scene.id}`
                      if (editMoveKey === `${day.id}::${move?.id}`)
                        return <MoveForm initialMinutes={String(move!.minutes)} initialNote={move!.note ?? ''} onSave={(m, n) => updateLocationMove(day.id, move!.id, m, n)} onCancel={() => setEditMoveKey(null)} />
                      if (move)
                        return <LocationMoveCard move={move} canEdit={canEdit} onEdit={() => setEditMoveKey(`${day.id}::${move.id}`)} onDelete={() => deleteLocationMove(day.id, move.id)} />
                      if (addMoveKey === key)
                        return <MoveForm onSave={(m, n) => saveLocationMove(day.id, scene.id, m, n)} onCancel={() => setAddMoveKey(null)} />
                      if (canEdit && idx < dayScenes.length - 1)
                        return (
                          <button onClick={() => setAddMoveKey(key)} className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-amber-400 transition-colors ml-1">
                            <MapPin className="w-3 h-3" /><span>Add location move</span>
                          </button>
                        )
                      return null
                    })()}
                  </div>
                ))}

                {dayScenes.length === 0 && (
                  <p className={cn('text-xs py-2 text-center rounded-lg transition-colors', dragOverDayId === day.id ? 'text-brand-400 bg-brand-900/20 border border-brand-700/40' : 'text-zinc-600')}>
                    {dragOverDayId === day.id ? 'Drop scene here' : 'No scenes scheduled for this day.'}
                  </p>
                )}

                {canEdit && availableToAdd.length > 0 && (
                  <div className="relative mt-2">
                    {dayScenes.length === 0 && (
                      <div className="text-sm text-gray-500 italic mb-2 flex items-center gap-2">
                        <span>☝️</span>
                        <span>Drag scenes from 'Unscheduled Scenes' above into this day to include them in the call sheet</span>
                      </div>
                    )}
                    {addToDay === day.id ? (
                      <div className="bg-zinc-800 border border-white/10 rounded-xl p-2 space-y-1">
                        <p className="text-xs text-zinc-400 px-1 pb-0.5 font-medium">Add scene:</p>
                        {availableToAdd.map(s => (
                          <button key={s.id} onClick={() => addSceneToDay(day.id, s.id)}
                            className="w-full text-left flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700/50 rounded-lg text-xs text-zinc-300">
                            <span className="font-mono text-zinc-400 w-4">{s.sceneNumber}</span>
                            {s.intExt} · {s.dayNight === 'Day' ? 'D' : 'N'} · {s.location || s.description || '(untitled)'}
                          </button>
                        ))}
                        <button onClick={() => setAddToDay(null)} className="w-full text-xs text-zinc-500 pt-1 hover:text-zinc-300">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setAddToDay(day.id)} className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Add scene to this day
                      </button>
                    )}
                  </div>
                )}

                {/* Generate Call Sheet button */}
                <div className="mt-3 pt-3 border-t border-white/8">
                  <button
                    disabled={exportingDayId === day.id}
                    onClick={() => setPreviewDay(day)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {exportingDayId === day.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <span>📋</span>
                    }
                    {exportingDayId === day.id ? 'Generating…' : 'Generate Call Sheet'}
                  </button>
                  {/* Notify crew toast */}
                  {crewNotifyKey === day.id && (
                    <div className="mt-2 flex items-center justify-between gap-2 bg-zinc-800 border border-white/10 rounded-xl px-3 py-2.5">
                      <span className="text-xs text-zinc-300">Call sheet downloaded. Notify crew?</span>
                      <div className="flex items-center gap-2">
                        <button
                          disabled={notifyingCrew}
                          onClick={() => notifyCrew(day)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          {notifyingCrew ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
                          Notify
                        </button>
                        <button onClick={() => setCrewNotifyKey(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1.5">Dismiss</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {canEdit && (
        <button onClick={addDay} className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 transition-colors">
          <Plus className="w-4 h-4" /> Add shooting day
        </button>
      )}

      {/* Call sheet preview modal */}
      {previewDay && (
        <CallSheetPreviewModal
          productionTitle={productionTitle}
          day={previewDay}
          dayNumber={previewDay.dayNumber}
          totalDays={days.length}
          dayScenes={(previewDay.sceneIds ?? []).map(sid => scenes.find(s => s.id === sid)).filter(Boolean) as ProductionSceneDoc[]}
          allCast={allCast}
          crew={allCrew}
          crewRoles={crewRoles}
          locations={locations}
          shots={shots}
          sunriseSunset={sunriseSunset[previewDay.id] ?? undefined}
          onDownload={() => doDownload(previewDay)}
          onDownloadPDF={() => doDownloadPDF(previewDay)}
          onClose={() => setPreviewDay(null)}
        />
      )}
    </div>
  )
}
