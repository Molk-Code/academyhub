import { useState, useMemo } from 'react'
import { doc, updateDoc, addDoc, deleteDoc, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { ProductionShotDoc, ProductionSceneDoc, ProductionShootingDayDoc } from '@/types'
import { Plus, Trash2, Camera, Clock } from 'lucide-react'

function parseTime(t: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim())
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)} min`
  const h = Math.floor(m / 60), rem = Math.round(m % 60)
  return rem > 0 ? `${h}h ${rem}min` : `${h}h`
}

const SIZE_OPTS     = ['Wide', 'Medium', 'Close-up', 'Extreme Close-up', 'Insert', 'Over-the-shoulder']
const ANGLE_OPTS    = ['Eye level', 'High angle', 'Low angle', 'Ground level', "Bird's eye", 'Dutch']
const MOVEMENT_OPTS = ['Static', 'Pan', 'Tilt', 'Track', 'Zoom', 'Handheld', 'Crane', 'Drone']

interface Props { productionId: string; canEdit: boolean }

export function ShotListTab({ productionId, canEdit }: Props) {
  const { data: scenes } = useCollection<ProductionSceneDoc>(
    `productions/${productionId}/scenes`,
    [orderBy('sceneNumber', 'asc')],
  )
  const { data: shots } = useCollection<ProductionShotDoc>(
    `productions/${productionId}/shots`,
    [orderBy('shotNumber', 'asc')],
  )
  const { data: shootingDays } = useCollection<ProductionShootingDayDoc>(
    `productions/${productionId}/shootingDays`,
    [orderBy('dayNumber', 'asc')],
  )

  // Per-scene available minutes per shot
  const minutesPerShot = useMemo(() => {
    const result: Record<string, number | null> = {}
    for (const day of shootingDays) {
      const rts  = parseTime(day.rtsTime ?? day.startTime)
      const wrap = parseTime(day.endTime)
      if (rts === null || wrap === null) continue
      const available = (wrap - rts) - (day.lunchDuration ?? 0)
      if (available <= 0) continue
      const daySceneIds = day.sceneIds ?? []
      const totalShots = shots.filter(sh => daySceneIds.includes(sh.sceneId)).length
      if (totalShots === 0) continue
      const mps = available / totalShots
      for (const sceneId of daySceneIds) result[sceneId] = mps
    }
    return result
  }, [shootingDays, shots])

  const [edits, setEdits] = useState<Record<string, Record<string, any>>>({})

  function get(id: string, field: string, fallback: any) {
    return edits[id]?.[field] ?? fallback
  }

  function setLocal(id: string, field: string, value: any) {
    if (!canEdit) return
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }))
  }

  async function save(id: string, field: string, value: any) {
    if (!canEdit) return
    await updateDoc(doc(db, `productions/${productionId}/shots`, id), { [field]: value })
    setEdits(prev => {
      const next = { ...prev }
      if (next[id]) {
        const { [field]: _, ...rest } = next[id]
        Object.keys(rest).length === 0 ? delete next[id] : (next[id] = rest)
      }
      return next
    })
  }

  async function addShot(sceneId: string) {
    const sceneShots = shots.filter(s => s.sceneId === sceneId)
    const maxNum = sceneShots.reduce((m, s) => Math.max(m, s.shotNumber), 0)
    await addDoc(collection(db, `productions/${productionId}/shots`), {
      sceneId,
      shotNumber: maxNum + 1,
      subject: '', size: 'Medium', angle: 'Eye level', movement: 'Static', notes: '',
    })
  }

  async function deleteShot(id: string) {
    await deleteDoc(doc(db, `productions/${productionId}/shots`, id))
  }

  function SelectField({ id, field, value, options }: { id: string; field: string; value: string; options: string[] }) {
    return canEdit ? (
      <select
        className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-full"
        value={get(id, field, value)}
        onChange={e => { setLocal(id, field, e.target.value); save(id, field, e.target.value) }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : (
      <span className="text-xs text-zinc-300">{value || '—'}</span>
    )
  }

  return (
    <div className="space-y-6">
      {scenes.map(scene => {
        const sceneShots = shots.filter(s => s.sceneId === scene.id)
        const dnLabel = scene.dayNight === 'Day' ? 'D' : 'N'

        return (
          <div key={scene.id} className="space-y-2">
            {/* Scene header */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'text-xs font-bold px-1.5 py-0.5 rounded',
                scene.dayNight === 'Night' ? 'bg-indigo-900/60 text-indigo-300' : 'bg-amber-900/40 text-amber-300',
              )}>{dnLabel}</span>
              <span className={cn(
                'text-xs font-bold px-1.5 py-0.5 rounded',
                scene.intExt === 'INT' ? 'bg-sky-900/50 text-sky-300' : 'bg-green-900/40 text-green-300',
              )}>{scene.intExt}</span>
              <h3 className="font-semibold text-zinc-200 text-sm">
                Scene {scene.sceneNumber}{scene.location ? ` — ${scene.location}` : ''}
              </h3>
              {scene.description && (
                <p className="text-xs text-zinc-500 truncate flex-1 hidden sm:block">{scene.description}</p>
              )}
              {minutesPerShot[scene.id] != null && (
                <span className="flex items-center gap-1 text-xs text-zinc-500 flex-shrink-0">
                  <Clock className="w-3 h-3" />
                  {fmtMinutes(minutesPerShot[scene.id]!)} / shot
                </span>
              )}
            </div>

            <div className="bg-zinc-900 border border-white/10 rounded-xl overflow-hidden">
              {/* ── Mobile shot cards (< md) ───────────────────────── */}
              {sceneShots.length > 0 && (
                <div className="md:hidden divide-y divide-white/5">
                  {sceneShots.map(shot => (
                    <div key={shot.id} className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-zinc-400">Shot {shot.shotNumber}</span>
                        {canEdit && (
                          <button
                            onClick={() => deleteShot(shot.id)}
                            className="p-1 text-zinc-500 hover:text-rose-400 transition-colors rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Subject</p>
                        {canEdit ? (
                          <input
                            className="bg-transparent w-full focus:bg-zinc-800/80 rounded px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                            value={get(shot.id, 'subject', shot.subject)}
                            placeholder="Subject…"
                            onChange={e => setLocal(shot.id, 'subject', e.target.value)}
                            onBlur={e => save(shot.id, 'subject', e.target.value)}
                          />
                        ) : (
                          <span className="text-sm text-zinc-200">{shot.subject || '—'}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Size</p>
                          <SelectField id={shot.id} field="size" value={shot.size} options={SIZE_OPTS} />
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Angle</p>
                          <SelectField id={shot.id} field="angle" value={shot.angle} options={ANGLE_OPTS} />
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Movement</p>
                          <SelectField id={shot.id} field="movement" value={shot.movement} options={MOVEMENT_OPTS} />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Notes</p>
                        {canEdit ? (
                          <input
                            className="bg-transparent w-full focus:bg-zinc-800/80 rounded px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                            value={get(shot.id, 'notes', shot.notes)}
                            placeholder="Notes…"
                            onChange={e => setLocal(shot.id, 'notes', e.target.value)}
                            onBlur={e => save(shot.id, 'notes', e.target.value)}
                          />
                        ) : (
                          <span className="text-sm text-zinc-300">{shot.notes || '—'}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Desktop table (>= md) ──────────────────────────── */}
              {sceneShots.length > 0 && (
                <table className="hidden md:table w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-zinc-900/80">
                      {['Shot', 'Subject', 'Size', 'Angle', 'Movement', 'Notes', ''].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider px-3 py-2 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {sceneShots.map(shot => (
                      <tr key={shot.id} className="group hover:bg-white/3 transition-colors">
                        <td className="px-3 py-2 w-12 text-xs font-mono text-zinc-400">{shot.shotNumber}</td>
                        <td className="px-2 py-1.5 min-w-[120px]">
                          {canEdit ? (
                            <input
                              className="bg-transparent w-full focus:bg-zinc-800/80 rounded px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                              value={get(shot.id, 'subject', shot.subject)}
                              placeholder="Subject…"
                              onChange={e => setLocal(shot.id, 'subject', e.target.value)}
                              onBlur={e => save(shot.id, 'subject', e.target.value)}
                            />
                          ) : (
                            <span className="text-sm text-zinc-200">{shot.subject || '—'}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 min-w-[110px]">
                          <SelectField id={shot.id} field="size" value={shot.size} options={SIZE_OPTS} />
                        </td>
                        <td className="px-2 py-1.5 min-w-[110px]">
                          <SelectField id={shot.id} field="angle" value={shot.angle} options={ANGLE_OPTS} />
                        </td>
                        <td className="px-2 py-1.5 min-w-[100px]">
                          <SelectField id={shot.id} field="movement" value={shot.movement} options={MOVEMENT_OPTS} />
                        </td>
                        <td className="px-2 py-1.5 min-w-[120px]">
                          {canEdit ? (
                            <input
                              className="bg-transparent w-full focus:bg-zinc-800/80 rounded px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
                              value={get(shot.id, 'notes', shot.notes)}
                              placeholder="Notes…"
                              onChange={e => setLocal(shot.id, 'notes', e.target.value)}
                              onBlur={e => save(shot.id, 'notes', e.target.value)}
                            />
                          ) : (
                            <span className="text-sm text-zinc-300">{shot.notes || '—'}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 w-8">
                          {canEdit && (
                            <button
                              onClick={() => deleteShot(shot.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 transition-all rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {sceneShots.length === 0 && (
                <div className="px-4 py-3 text-xs text-zinc-600 flex items-center gap-2">
                  <Camera className="w-3.5 h-3.5" /> No shots yet for this scene.
                </div>
              )}

              {canEdit && (
                <div className="px-3 py-2 border-t border-white/5">
                  <button
                    onClick={() => addShot(scene.id)}
                    className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add shot
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {scenes.length === 0 && (
        <div className="text-center py-10 text-zinc-500">
          <p className="text-sm">Add scenes in the Script Breakdown tab first.</p>
        </div>
      )}
    </div>
  )
}
