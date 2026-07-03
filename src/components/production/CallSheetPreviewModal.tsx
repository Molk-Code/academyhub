import { X, FileSpreadsheet } from 'lucide-react'
import type {
  ProductionShootingDayDoc, ProductionSceneDoc, ProductionCastDoc,
  ProductionCrewAssignmentDoc, ProductionLocationDoc, CrewRoleDoc, ProductionShotDoc,
} from '@/types'

export function parseTime(t: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim())
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

function parseLegacyWorkHours(wh: string): { startTime: string; endTime: string } | null {
  const m = /^(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})$/.exec((wh ?? '').trim())
  if (!m) return null
  return { startTime: m[1], endTime: m[2] }
}

export function getStartEnd(day: ProductionShootingDayDoc): { startTime: string; endTime: string } {
  if (day.startTime && day.endTime) return { startTime: day.startTime, endTime: day.endTime }
  const parsed = parseLegacyWorkHours(day.workHours)
  return parsed ?? { startTime: '', endTime: '' }
}

export function CallSheetPreviewModal({
  productionTitle, day, dayNumber, totalDays, dayScenes, allCast, crew, crewRoles, locations, shots, sunriseSunset,
  onDownload, onDownloadPDF, onClose,
}: {
  productionTitle: string
  day: ProductionShootingDayDoc
  dayNumber: number
  totalDays: number
  dayScenes: ProductionSceneDoc[]
  allCast: ProductionCastDoc[]
  crew: ProductionCrewAssignmentDoc[]
  crewRoles: CrewRoleDoc[]
  locations: ProductionLocationDoc[]
  shots: ProductionShotDoc[]
  sunriseSunset?: { sunrise: string; sunset: string; weather?: string; temp?: string }
  onDownload?: () => void
  onDownloadPDF?: () => void
  onClose: () => void
}) {
  const { startTime, endTime } = getStartEnd(day)
  const sMin = parseTime(startTime), eMin = parseTime(endTime)
  const lunchMin = day.lunchDuration ?? 0
  const workHrsStr = sMin !== null && eMin !== null
    ? `${(((eMin - sMin) - lunchMin) / 60).toFixed(1)}h${lunchMin ? ` (${lunchMin} min lunch)` : ''}`
    : (day.workHours || '—')
  const dateStr = day.date
    ? new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
  const rts = day.rtsTime || startTime || '—'
  const daySceneIds = new Set(dayScenes.map(s => s.id))
  const daysCastIds = new Set(dayScenes.flatMap(s => s.castIds ?? []))
  const daysCast = allCast.filter(c => daysCastIds.has(c.castId))
  const locById = Object.fromEntries(locations.map(l => [l.id, l]))
  const orderedCrew = [
    ...crewRoles.map(role => crew.find(c => c.roleId === role.id)).filter(Boolean) as ProductionCrewAssignmentDoc[],
    ...crew.filter(c => !crewRoles.map(r => r.id).includes(c.roleId ?? '')),
  ].filter(c => c.assignedName)
  const dayShots = shots.filter(sh => daySceneIds.has(sh.sceneId))
  const showExport = !!(onDownload && onDownloadPDF)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-white text-base">Call Sheet Preview</h2>
            <p className="text-xs text-zinc-400 mt-0.5">{productionTitle} — Day {dayNumber} of {totalDays}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4 text-sm">
          {/* Date + timing */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/60 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Date</p>
              <p className="text-zinc-100 font-medium text-xs">{dateStr}</p>
            </div>
            <div className="bg-zinc-800/60 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Working Hours</p>
              <p className="text-zinc-100 font-medium text-xs">{workHrsStr}</p>
            </div>
            <div className="bg-zinc-800/60 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">RTS</p>
              <p className="text-emerald-400 font-bold text-xs">{rts}</p>
            </div>
            <div className="bg-zinc-800/60 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Lunch</p>
              <p className="text-amber-400 font-medium text-xs">
                {day.lunchStart ? `${day.lunchStart}${lunchMin ? ` (${lunchMin} min)` : ''}` : '—'}
              </p>
            </div>
          </div>
          {/* Notes */}
          {day.notes && (
            <div className="bg-zinc-800/60 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-zinc-300 text-xs italic">{day.notes}</p>
            </div>
          )}
          {/* Scenes */}
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Scenes ({dayScenes.length})</p>
            {dayScenes.length === 0
              ? <p className="text-zinc-500 text-xs italic">No scenes scheduled.</p>
              : (
              <div className="space-y-1">
                {dayScenes.map(sc => {
                  const loc = sc.locationId ? locById[sc.locationId] : null
                  const scShots = dayShots.filter(sh => sh.sceneId === sc.id)
                  return (
                    <div key={sc.id} className="flex items-start gap-2 px-2.5 py-2 bg-zinc-800/40 rounded-lg text-xs">
                      <span className="font-mono text-zinc-300 w-5 flex-shrink-0">{sc.sceneNumber}</span>
                      <span className="text-zinc-500 flex-shrink-0">{sc.intExt}·{sc.dayNight === 'Day' ? 'D' : 'N'}</span>
                      <span className="text-zinc-300 flex-1">{sc.location || '—'}{loc?.address ? ` · ${loc.address}` : ''}</span>
                      {(sc.castIds ?? []).length > 0 && <span className="text-zinc-500 flex-shrink-0">Cast: {(sc.castIds ?? []).join(',')}</span>}
                      {scShots.length > 0 && <span className="text-sky-500 flex-shrink-0">{scShots.length} shots</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {/* Cast */}
          {daysCast.length > 0 && (
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Cast ({daysCast.length})</p>
              <div className="grid grid-cols-2 gap-1">
                {daysCast.map(c => (
                  <div key={c.castId} className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800/40 rounded-lg text-xs">
                    <span className="text-zinc-500 w-4 flex-shrink-0">{c.castId}</span>
                    <span className="text-zinc-300 font-medium truncate">{c.actorName}</span>
                    {c.characterName && <span className="text-zinc-500 truncate italic">({c.characterName})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Crew */}
          {orderedCrew.length > 0 && (
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Crew ({orderedCrew.length})</p>
              <div className="grid grid-cols-2 gap-1">
                {orderedCrew.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800/40 rounded-lg text-xs">
                    <span className="text-zinc-500 truncate">{c.roleName}</span>
                    <span className="text-zinc-300 font-medium truncate flex-1 text-right">{c.assignedName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose} className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
            {showExport ? 'Cancel' : 'Close'}
          </button>
          {showExport && (
            <>
              <button onClick={onDownloadPDF} className="flex-1 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                <span>📄</span> Download PDF
              </button>
              <button onClick={onDownload} className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                <FileSpreadsheet className="w-4 h-4" /> Download XLS
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
