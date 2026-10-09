import { useState, useEffect } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import type { ProductionDoc, PeriodAllocationDoc, UserDoc } from '@/types'
import { X, Check, Trash2, AlertTriangle, Clock, MapPin, Users } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { timesOverlap } from './productionPeriodShared'

export function AllocationEditor({ periodId, date, production, existing, allAllocations, students, color, onClose }: {
  periodId: string
  date: string
  production: ProductionDoc
  existing: PeriodAllocationDoc | null
  allAllocations: PeriodAllocationDoc[]
  students: UserDoc[]
  color: string
  onClose: () => void
}) {
  const [startTime,  setStartTime]  = useState(existing?.startTime ?? '08:00')
  const [endTime,    setEndTime]    = useState(existing?.endTime ?? '17:00')
  const [location,   setLocation]   = useState(existing?.location ?? '')
  const [crewNeeded, setCrewNeeded] = useState<string[]>(existing?.crewNeeded ?? [])
  const [notes,      setNotes]      = useState(existing?.notes ?? '')
  const [saving,     setSaving]     = useState(false)
  const [warnings,   setWarnings]   = useState<string[]>([])

  // Auto-populate from production's own shooting day
  useEffect(() => {
    if (existing) return
    import('firebase/firestore').then(({ getDocs, query, collection: col, where: fWhere }) => {
      getDocs(query(col(db, `productions/${production.id}/shootingDays`), fWhere('date', '==', date)))
        .then(snap => {
          if (snap.empty) return
          const day = snap.docs[0].data() as any
          if (day.startTime) setStartTime(day.startTime)
          if (day.endTime)   setEndTime(day.endTime)
        })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function checkConflicts(): string[] {
    const issues: string[] = []
    const others = allAllocations.filter(a =>
      a.date === date && a.productionId !== production.id && a.id !== (existing?.id ?? ''),
    )
    for (const other of others) {
      if (!timesOverlap(startTime, endTime, other.startTime, other.endTime)) continue
      const shared = crewNeeded.filter(uid => other.crewNeeded.includes(uid))
      if (shared.length) {
        const names = shared.map(uid => students.find(s => s.uid === uid)?.displayName ?? uid)
        issues.push(`${names.join(', ')} is also in "${other.productionTitle}" at the same time`)
      }
      if (location && other.location && location.trim().toLowerCase() === other.location.trim().toLowerCase())
        issues.push(`Location "${location}" is already booked by "${other.productionTitle}"`)
    }
    return issues
  }

  async function handleSave() {
    setSaving(true)
    const ws = checkConflicts()
    setWarnings(ws)
    const payload = {
      productionId:    production.id,
      productionTitle: production.title,
      date,
      startTime,
      endTime,
      location:    location.trim(),
      crewNeeded,
      notes:       notes.trim(),
      color,
    }
    try {
      if (existing) {
        await updateDoc(doc(db, `production_periods/${periodId}/allocations`, existing.id), payload)
      } else {
        await addDoc(collection(db, `production_periods/${periodId}/allocations`), { ...payload, createdAt: serverTimestamp() })
      }
      if (ws.length === 0) onClose()
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!existing || !confirm('Remove this allocation?')) return
    await deleteDoc(doc(db, `production_periods/${periodId}/allocations`, existing.id))
    onClose()
  }

  function toggleCrew(uid: string) {
    setCrewNeeded(prev => prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{production.title}</p>
            <p className="text-xs text-zinc-400">{format(parseISO(date), 'EEEE, d MMMM yyyy')}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <div className="flex items-center gap-2 flex-1">
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-28 [color-scheme:dark]" />
              <span className="text-zinc-500 text-sm">–</span>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-28 [color-scheme:dark]" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <MapPin className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <input value={location} onChange={e => setLocation(e.target.value)}
              placeholder="Shooting location…"
              className="flex-1 bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 placeholder:text-zinc-600" />
          </div>
          {students.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-zinc-500" />
                <p className="text-xs font-medium text-zinc-400">Crew needed</p>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {students.map(s => (
                  <label key={s.uid} className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-sm transition-colors',
                    crewNeeded.includes(s.uid) ? 'bg-brand-900/40 text-brand-300' : 'text-zinc-400 hover:bg-zinc-800',
                  )}>
                    <input type="checkbox" checked={crewNeeded.includes(s.uid)}
                      onChange={() => toggleCrew(s.uid)} className="w-3.5 h-3.5 accent-brand-500 flex-shrink-0" />
                    <span className="truncate text-xs">{s.displayName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)…" rows={2}
            className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500/30 placeholder:text-zinc-600" />
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
              <p className="text-xs text-zinc-500">Conflicts are advisory — you can still save.</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand-600 text-white hover:bg-brand-500 rounded-xl transition-colors disabled:opacity-50">
            <Check className="w-3.5 h-3.5" />
            {warnings.length > 0 ? 'Save anyway' : existing ? 'Save changes' : 'Add allocation'}
          </button>
          {existing && (
            <button onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-zinc-500 hover:text-rose-400 transition-colors rounded-xl">
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          )}
          <button onClick={onClose} className="ml-auto text-sm text-zinc-500 hover:text-zinc-300 px-3 py-2">Cancel</button>
        </div>
      </div>
    </div>
  )
}
