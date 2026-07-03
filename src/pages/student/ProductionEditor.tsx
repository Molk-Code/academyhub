import { useState, useMemo } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import {
  doc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp, arrayUnion, arrayRemove,
  getDocs, query, where as fsWhere,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { uploadResumableWithQuota } from '@/lib/uploadWithQuota'
import { useAuth } from '@/contexts/AuthContext'
import { useDocument, useCollection, where, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { ProductionDoc, UserDoc, ProductionFeedbackDoc, ProductionTeamDoc, ProductionSceneDoc, ProductionCastDoc, ProductionShotDoc, ProductionShootingDayDoc, ProductionCrewAssignmentDoc, ProductionLocationDoc, ProductionPeriodDoc } from '@/types'
import { ArrowLeft, Users, Globe, Lock, Trash2, MessageSquare, X, Send, ChevronDown, Download, FileSpreadsheet, UserPlus, Eye, Loader2, FileText, Upload, Sparkles, CheckCircle2 } from 'lucide-react'
import { parseScreenplayPDF, type ParsedScene } from '@/lib/parseScreenplay'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import Avatar from '@/components/common/Avatar'
import { BreakdownTab }  from './production/BreakdownTab'
import { CrewTab }       from './production/CrewTab'
import { CastTab }       from './production/CastTab'
import { ShotListTab }   from './production/ShotListTab'
import { ScheduleTab }   from './production/ScheduleTab'
import { LocationsTab }  from './production/LocationsTab'
import ShotLogTab        from '@/components/production/ShotLogTab'
import { BudgetTab }     from '@/components/production/BudgetTab'

type Tab = 'script' | 'breakdown' | 'crew' | 'cast' | 'shots' | 'locations' | 'schedule' | 'shotlog' | 'budget'

const TABS: { id: Tab; label: string }[] = [
  { id: 'script',    label: 'Script' },
  { id: 'breakdown', label: 'Script Breakdown' },
  { id: 'crew',      label: 'Crew' },
  { id: 'cast',      label: 'Cast' },
  { id: 'shots',     label: 'Shot List' },
  { id: 'locations', label: 'Locations' },
  { id: 'schedule',  label: 'Schedule' },
  { id: 'budget',    label: 'Budget' },
  { id: 'shotlog',   label: 'Shot Log' },
]

function getProductionReadiness(
  scenes: ProductionSceneDoc[],
  crew: ProductionCrewAssignmentDoc[],
  cast: ProductionCastDoc[],
  locations: ProductionLocationDoc[],
  shootingDays: ProductionShootingDayDoc[],
) {
  const hasBreakdown = scenes.length >= 1
  const hasCrew = crew.some(c => c.assignedName?.trim() !== '')
  const hasCast = cast.length >= 1
  const hasLocations = locations.length >= 1
  const hasSchedule = shootingDays.some(d => (d.sceneIds?.length ?? 0) >= 1)
  const checks = [hasBreakdown, hasCrew, hasCast, hasLocations, hasSchedule]
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100)
  return { isReady: score === 100, score, hasBreakdown, hasCrew, hasCast, hasLocations, hasSchedule }
}

function relTime(ts: any): string {
  if (!ts?.toDate) return ''
  const diff = (Date.now() - ts.toDate().getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}


// ── XLS export (client-side, multi-sheet with styling) ───────────────────────
async function exportXLS(
  production: ProductionDoc,
  scenes: ProductionSceneDoc[],
  cast: ProductionCastDoc[],
  shots: ProductionShotDoc[],
  shootingDays: ProductionShootingDayDoc[],
  crew: ProductionCrewAssignmentDoc[],
  locations: ProductionLocationDoc[],
) {
  const XLSX = await import('xlsx-js-style')

  const sceneById = Object.fromEntries(scenes.map(s => [s.id, s]))
  const castById  = Object.fromEntries(cast.map(c => [String(c.castId), c]))
  const castNames = (ids: number[]) =>
    (ids ?? []).map(id => castById[String(id)]?.characterName ?? `ID${id}`).join(', ')

  const sortedScenes = [...scenes].sort((a, b) => a.sceneNumber - b.sceneNumber)
  const sortedCast   = [...cast].sort((a, b) => a.castId - b.castId)
  const sortedDays   = [...shootingDays].sort((a, b) => a.dayNumber - b.dayNumber)
  const sortedShots  = [...shots].sort((a, b) => {
    const sn = (sceneById[a.sceneId]?.sceneNumber ?? 0) - (sceneById[b.sceneId]?.sceneNumber ?? 0)
    return sn !== 0 ? sn : a.shotNumber - b.shotNumber
  })

  // ── Light professional palette ────────────────────────────────────────────────
  const TITLE_BG = '1E3A5F', TITLE_FG = 'FFFFFF'
  const HDR_BG   = '2E75B6', HDR_FG   = 'FFFFFF'
  const WHITE    = 'FFFFFF', ALT      = 'EEF4FB', TEXT = '1A1A2E'
  const DAY_BG   = 'D6E4F0', DAY_FG   = '1E3A5F'
  const SCENE_BG = '2E75B6', SCENE_FG = 'FFFFFF'
  const ROW1_BG  = 'F2F7FD'
  const SUBTLE   = '6B7280'

  function cs(
    bg: string, fg: string, bold: boolean, sz = 11,
    italic = false,
    halign: 'left' | 'center' | 'right' = 'left',
    valign: 'center' | 'top' | 'bottom' = 'center',
  ): any {
    const border = { style: 'thin', color: { rgb: 'CBD5E1' } }
    return {
      fill: { patternType: 'solid', fgColor: { rgb: bg } },
      font: { name: 'Calibri', bold, sz, color: { rgb: fg }, italic },
      alignment: { wrapText: true, vertical: valign, horizontal: halign },
      border: { top: border, bottom: border, left: border, right: border },
    }
  }

  const wb = XLSX.utils.book_new()

  function addSheet(
    name: string, title: string, headers: string[],
    rows: (string | number | null | undefined)[][], colWidths: number[],
  ) {
    const ncols = headers.length
    const data: any[][] = [[title], headers, ...rows.map(r => r.map(v => v ?? ''))]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = colWidths.map(w => ({ wch: w }))
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } }]
    ws['!rows'] = [{ hpt: 30 }, { hpt: 18 }, ...rows.map(() => ({ hpt: 16 }))]
    const titleCell = ws['A1'] ?? (ws['A1'] = { t: 's', v: title })
    titleCell.s = cs(TITLE_BG, TITLE_FG, true, 15)
    for (let c = 0; c < ncols; c++) {
      const ref = XLSX.utils.encode_cell({ r: 1, c })
      if (!ws[ref]) ws[ref] = { t: 's', v: headers[c] }
      ws[ref].s = cs(HDR_BG, HDR_FG, true, 11, false, 'center')
    }
    rows.forEach((_, ri) => {
      const bg = ri % 2 === 0 ? WHITE : ALT
      for (let c = 0; c < ncols; c++) {
        const ref = XLSX.utils.encode_cell({ r: ri + 2, c })
        if (!ws[ref]) ws[ref] = { t: 's', v: '' }
        ws[ref].s = cs(bg, TEXT, false, 11)
      }
    })
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  // ── Breakdown ────────────────────────────────────────────────────────────────
  addSheet('Breakdown', `Script Breakdown — ${production.title}`,
    ['Scene', 'D/N', 'INT/EXT', 'Location', 'Description', 'Character/s', 'Props', 'Make-up', 'Costumes', 'Notes'],
    sortedScenes.map(s => [s.sceneNumber, s.dayNight, s.intExt, s.location, s.description,
      castNames(s.castIds), s.props, s.makeup, s.costume, s.notes]),
    [7, 8, 9, 22, 34, 26, 22, 22, 22, 22])

  // ── Crew ─────────────────────────────────────────────────────────────────────
  if (crew.length > 0) {
    addSheet('Crew', `Crew — ${production.title}`,
      ['Role', 'Assigned Name'],
      crew.map(c => [c.roleName, c.assignedName]),
      [30, 40])
  }

  // ── Shotlist ─────────────────────────────────────────────────────────────────
  addSheet('Shotlist', `Shotlist — ${production.title}`,
    ['Scene', 'Shot', 'Subject', 'Size', 'Angle', 'Movement', 'Notes'],
    sortedShots.map(sh => [sceneById[sh.sceneId]?.sceneNumber ?? null,
      sh.shotNumber, sh.subject, sh.size, sh.angle, sh.movement, sh.notes]),
    [8, 8, 26, 16, 16, 16, 34])

  // ── Locations ────────────────────────────────────────────────────────────────
  // Map locationId → scene numbers
  const scenesByLocId = new Map<string, number[]>()
  sortedScenes.forEach(s => {
    if (s.locationId) {
      if (!scenesByLocId.has(s.locationId)) scenesByLocId.set(s.locationId, [])
      scenesByLocId.get(s.locationId)!.push(s.sceneNumber)
    }
  })
  // Rows from the locations subcollection (have addresses)
  const locRows: (string | number)[][] = locations.map(l => [
    (scenesByLocId.get(l.id) ?? []).join(', '),
    l.name,
    '',
    [l.address, l.zipCode, l.state].filter(Boolean).join(', '),
    l.notes ?? '',
  ])
  // Also add scenes that only have a text location (no locationId)
  const unlinkedLocMap = new Map<string, { scenes: number[]; intExt: string }>()
  sortedScenes.filter(s => !s.locationId && s.location).forEach(s => {
    if (!unlinkedLocMap.has(s.location)) unlinkedLocMap.set(s.location, { scenes: [], intExt: s.intExt })
    unlinkedLocMap.get(s.location)!.scenes.push(s.sceneNumber)
  })
  unlinkedLocMap.forEach((v, name) => {
    locRows.push([v.scenes.join(', '), name, v.intExt, '', ''])
  })
  addSheet('Locations', `Locations — ${production.title}`,
    ['Scene/s', 'Location', 'INT/EXT', 'Address', 'Notes'],
    locRows,
    [14, 32, 10, 52, 28])

  // ── Actors ───────────────────────────────────────────────────────────────────
  addSheet('Actors', `Actors — ${production.title}`,
    ['ID', 'Character', 'Actor', 'Scenes'],
    sortedCast.map(c => [c.castId, c.characterName, c.actorName, (c.scenes ?? []).join(', ')]),
    [7, 28, 28, 28])

  // ── Props ─────────────────────────────────────────────────────────────────────
  addSheet('Props', `Props — ${production.title}`,
    ['Scene', 'Props'],
    sortedScenes.filter(s => s.props?.trim()).map(s => [s.sceneNumber, s.props]),
    [8, 56])

  // ── Make-Up ───────────────────────────────────────────────────────────────────
  addSheet('Make-Up', `Make-Up — ${production.title}`,
    ['Scene', 'Character', 'Make-Up Notes'],
    sortedScenes.filter(s => s.makeup?.trim()).map(s => [s.sceneNumber, castNames(s.castIds), s.makeup]),
    [8, 28, 46])

  // ── Costume ───────────────────────────────────────────────────────────────────
  addSheet('Costume', `Costume — ${production.title}`,
    ['Scene', 'Character', 'Costume'],
    sortedScenes.filter(s => s.costume?.trim()).map(s => [s.sceneNumber, castNames(s.castIds), s.costume]),
    [8, 28, 46])

  // ── Schedule — 2-row per scene matching the call-sheet format ─────────────────
  {
    // Cols: Scene(0) | INT/EXT → D/N(1) | Location → Description(2) | Cast(3) | Notes(4)
    const NCOLS = 5
    const colWidths = [9, 10, 44, 28, 20]
    const headers   = ['Scene', 'INT/EXT', 'Location', 'Cast', 'Notes']

    const aoa: any[][] = [
      [`Shooting Schedule — ${production.title}`],
      headers,
    ]
    const styles: any[][] = [
      Array(NCOLS).fill(cs(TITLE_BG, TITLE_FG, true, 15)),
      headers.map(() => cs(HDR_BG, HDR_FG, true, 11, false, 'center')),
    ]
    const merges: any[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: NCOLS - 1 } }]
    const rowHeights: number[] = [30, 18]

    sortedDays.forEach(day => {
      // Day banner
      const dateLabel = day.date
        ? new Date(day.date + 'T12:00:00').toLocaleDateString('en-SE', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          }).toUpperCase()
        : ''
      const workLine = day.startTime && day.endTime
        ? `  ·  ${day.startTime}–${day.endTime}`
        : day.workHours ? `  ·  ${day.workHours}` : ''
      const dayLabel = `DAY ${day.dayNumber}${dateLabel ? `   ·   ${dateLabel}` : ''}${workLine}`
      const dayR = aoa.length
      aoa.push([dayLabel, '', '', '', ''])
      styles.push(Array(NCOLS).fill(cs(DAY_BG, DAY_FG, true, 11, false, 'center')))
      merges.push({ s: { r: dayR, c: 0 }, e: { r: dayR, c: NCOLS - 1 } })
      rowHeights.push(22)

      // Scenes — 2 rows each
      const dayScenes = (day.sceneIds ?? [])
        .map((sid: string) => sceneById[sid]).filter(Boolean)
        .sort((a: any, b: any) => (a.sceneNumber ?? 0) - (b.sceneNumber ?? 0))

      dayScenes.forEach((s: any) => {
        const r1 = aoa.length
        const r2 = r1 + 1
        const names = castNames(s.castIds)
        // Row 1: Scene# | I/E | LOCATION CAPS | Cast | Notes
        aoa.push([s.sceneNumber ?? '', s.intExt ?? '', (s.location ?? '').toUpperCase(), names, s.notes ?? ''])
        // Row 2: (merged scene#) | D/N | Description (merged cols 2-4) | |
        aoa.push(['', s.dayNight ?? '', s.description ?? '', '', ''])

        styles.push([
          cs(SCENE_BG, SCENE_FG, true,  13, false, 'center'),
          cs(ROW1_BG,  '1E3A5F', true,   9, false, 'center'),
          cs(ROW1_BG,  '1E3A5F', true,   9),
          cs(ROW1_BG,  TEXT,     false,  9),
          cs(ROW1_BG,  TEXT,     false,  9),
        ])
        styles.push([
          cs(SCENE_BG, SCENE_FG, false,  9, false, 'center'),
          cs(WHITE,    SUBTLE,   false,  9, true,  'center'),
          cs(WHITE,    TEXT,     false,  9, true),
          cs(WHITE,    TEXT,     false,  9, true),
          cs(WHITE,    TEXT,     false,  9, true),
        ])

        merges.push({ s: { r: r1, c: 0 }, e: { r: r2, c: 0 } })           // scene# spans both rows
        merges.push({ s: { r: r2, c: 2 }, e: { r: r2, c: NCOLS - 1 } })   // description spans cols 2-4
        rowHeights.push(20, 15)
      })

      // End of day summary
      const eodR = aoa.length
      const cnt  = dayScenes.length
      aoa.push([`End of Day ${day.dayNumber}  ·  ${cnt} scene${cnt !== 1 ? 's' : ''}`, '', '', '', ''])
      styles.push(Array(NCOLS).fill(cs(WHITE, SUBTLE, false, 9, true, 'center')))
      merges.push({ s: { r: eodR, c: 0 }, e: { r: eodR, c: NCOLS - 1 } })
      rowHeights.push(16)

      // Spacer
      aoa.push(['', '', '', '', ''])
      styles.push(Array(NCOLS).fill(cs(WHITE, TEXT, false, 6)))
      rowHeights.push(6)
    })

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = colWidths.map(w => ({ wch: w }))
    ws['!merges'] = merges
    ws['!rows'] = rowHeights.map(h => ({ hpt: h }))

    aoa.forEach((_, ri) => {
      for (let ci = 0; ci < NCOLS; ci++) {
        const ref = XLSX.utils.encode_cell({ r: ri, c: ci })
        if (!ws[ref]) ws[ref] = { t: 's', v: '' }
        if (styles[ri]?.[ci]) ws[ref].s = styles[ri][ci]
      }
    })

    XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
  }

  // ── Write ─────────────────────────────────────────────────────────────────────
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${production.title.replace(/[^a-z0-9]/gi, '_')}_global_plan_${Date.now()}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

// ── FeedbackPanel ─────────────────────────────────────────────────────────────
function FeedbackPanel({
  productionId, tab, onClose,
}: {
  productionId: string; tab: Tab; onClose: () => void
}) {
  const { data: feedback } = useCollection<ProductionFeedbackDoc>(
    `productions/${productionId}/feedback`,
    [where('tab', '==', tab), orderBy('createdAt', 'desc')],
  )
  const { profile } = useAuth()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function submit() {
    if (!text.trim() || !profile) return
    setSending(true)
    try {
      await addDoc(collection(db, `productions/${productionId}/feedback`), {
        tab,
        comment: text.trim(),
        teacherId: profile.uid,
        teacherName: profile.displayName,
        createdAt: serverTimestamp(),
      })
      setText('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 bg-zinc-900 border-l border-white/10 shadow-2xl flex flex-col z-40">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div>
          <p className="font-semibold text-zinc-100 text-sm">Teacher Feedback</p>
          <p className="text-xs text-zinc-500 capitalize">{tab} tab</p>
        </div>
        <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {feedback.length === 0 && (
          <p className="text-xs text-zinc-500 text-center pt-4">No feedback on this tab yet.</p>
        )}
        {feedback.map(f => (
          <div key={f.id} className="bg-zinc-800/60 rounded-xl p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-brand-400">{f.teacherName}</span>
              <span className="text-[10px] text-zinc-500">{relTime(f.createdAt)}</span>
            </div>
            <p className="text-sm text-zinc-200 leading-relaxed">{f.comment}</p>
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-white/10 space-y-2">
        <textarea
          rows={3}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Leave feedback…"
          className="input w-full resize-none text-sm"
        />
        <button
          onClick={submit}
          disabled={sending || !text.trim()}
          className="btn-primary w-full py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
          {sending ? 'Sending…' : 'Send Feedback'}
        </button>
      </div>
    </div>
  )
}

// ── CollaboratorRow ────────────────────────────────────────────────────────────
function CollaboratorRow({
  productionId, uid, isCreator, canRemove,
}: {
  productionId: string; uid: string; isCreator: boolean; canRemove: boolean
}) {
  const { data: user } = useDocument<UserDoc>('users', uid)
  const [removing, setRemoving] = useState(false)

  async function remove() {
    setRemoving(true)
    await updateDoc(doc(db, 'productions', productionId), { collaborators: arrayRemove(uid) })
    setRemoving(false)
  }

  return (
    <div className="flex items-center gap-2 group">
      <Avatar uid={uid} name={user?.displayName ?? uid} avatarUrl={user?.avatarUrl ?? null} size="xs" />
      <span className="text-sm text-zinc-300 flex-1 truncate">
        {user?.displayName ?? uid}
        {isCreator && <span className="ml-1 text-[10px] text-zinc-500">(creator)</span>}
      </span>
      {canRemove && !isCreator && (
        <button
          onClick={remove}
          disabled={removing}
          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 transition-all rounded"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ProductionEditor() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const backUrl = pathname.startsWith('/teacher') ? '/teacher/production' : '/production'
  const initialTab = (new URLSearchParams(search).get('tab') as Tab | null) ?? 'script'

  const [activeTab, setActiveTab]       = useState<Tab>(initialTab)
  const [showCollabs, setShowCollabs]   = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showExports, setShowExports]   = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingXls, setExportingXls] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [addCollabEmail, setAddCollabEmail] = useState('')
  const [addCollabError, setAddCollabError] = useState('')
  const [addingCollab, setAddingCollab] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleVal, setTitleVal] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parsedScenes, setParsedScenes] = useState<ParsedScene[] | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const { data: production, loading } = useDocument<ProductionDoc>('productions', id ?? '')

  const { data: allCohortUsers } = useCollection<UserDoc>(
    'users',
    production?.cohortId ? [where('cohortId', '==', production.cohortId)] : [],
    !!production?.cohortId,
    production?.cohortId ?? '',
  )

  const { data: cohortTeams } = useCollection<ProductionTeamDoc>(
    'production_teams',
    production?.cohortId ? [where('cohortId', '==', production.cohortId)] : [],
    !!production?.cohortId,
    production?.cohortId ?? '',
  )

  // Data for exports
  const { data: scenes } = useCollection<ProductionSceneDoc>(
    `productions/${id}/scenes`,
    [orderBy('sceneNumber', 'asc')],
    !!id,
  )
  const { data: cast } = useCollection<ProductionCastDoc>(
    `productions/${id}/cast`,
    [orderBy('castId', 'asc')],
    !!id,
  )
  const { data: shots } = useCollection<ProductionShotDoc>(
    `productions/${id}/shots`,
    [orderBy('shotNumber', 'asc')],
    !!id,
  )
  const { data: shootingDays } = useCollection<ProductionShootingDayDoc>(
    `productions/${id}/shootingDays`,
    [orderBy('dayNumber', 'asc')],
    !!id,
  )
  const { data: crewAssignments } = useCollection<ProductionCrewAssignmentDoc>(
    `productions/${id}/crew`,
    [],
    !!id,
  )
  const { data: locations } = useCollection<ProductionLocationDoc>(
    `productions/${id}/locations`,
    [],
    !!id,
  )

  const { data: productionPeriods } = useCollection<ProductionPeriodDoc>(
    'production_periods',
    production?.cohortId ? [where('cohortId', '==', production.cohortId)] : [],
    !!production?.cohortId,
    production?.cohortId ?? '',
  )

  const readiness = useMemo(
    () => getProductionReadiness(scenes, crewAssignments, cast, locations, shootingDays),
    [scenes, crewAssignments, cast, locations, shootingDays],
  )

  const isTeacherOrAdmin = profile?.role === 'teacher' || profile?.role === 'admin'
  const canEdit = !!(profile && production && (
    production.createdBy === profile.uid ||
    production.collaborators?.includes(profile.uid) ||
    isTeacherOrAdmin
  ))
  const isOwner = production?.createdBy === profile?.uid

  const allCollabIds = useMemo(() => {
    if (!production) return []
    return [production.createdBy, ...(production.collaborators ?? [])]
  }, [production])

  async function saveTitle() {
    if (!id || !titleVal.trim()) { setTitleEditing(false); return }
    await updateDoc(doc(db, 'productions', id), {
      title: titleVal.trim(),
      updatedAt: serverTimestamp(),
      lastEditedBy: profile?.uid,
    })
    setTitleEditing(false)
  }

  async function uploadScreenplay(file: File) {
    if (!id) return
    const path = `productions/${id}/screenplay.pdf`
    setUploadProgress(0)
    setParsedScenes(null)
    setImportSuccess(false)
    uploadResumableWithQuota(file, path, { contentType: 'application/pdf' }, pct => setUploadProgress(pct))
      .then(async url => {
        await updateDoc(doc(db, 'productions', id), {
          screenplayUrl: url,
          screenplayName: file.name,
          updatedAt: serverTimestamp(),
        })
        setUploadProgress(null)
        setParsing(true)
        try {
          const detected = await parseScreenplayPDF(file)
          if (detected.length > 0) {
            setParsedScenes(detected)
            setShowImportModal(true)
          }
        } catch {
          // silently skip parsing if PDF text extraction fails
        } finally {
          setParsing(false)
        }
      })
      .catch(err => {
        setUploadProgress(null)
        console.error('Upload failed:', err)
        alert(err.message ?? 'Upload failed.')
      })
  }

  async function deleteAllScenes() {
    if (!id) return
    const snap = await getDocs(collection(db, 'productions', id, 'scenes'))
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  }

  async function handleImportScenes(selected: ParsedScene[]) {
    if (!id) return
    setImporting(true)
    await deleteAllScenes()
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i]
      await addDoc(collection(db, 'productions', id, 'scenes'), {
        sceneNumber: i + 1,
        intExt: s.intExt,
        location: s.location,
        dayNight: s.dayNight,
        description: '',
        cast: [],
        props: [],
        costumes: [],
        makeup: [],
        sfx: [],
        notes: '',
      })
    }
    setImporting(false)
    setShowImportModal(false)
    setImportSuccess(true)
    setActiveTab('breakdown')
  }

  async function removeScreenplay() {
    if (!id || !confirm('Remove the screenplay and its scenes from this production?')) return
    await updateDoc(doc(db, 'productions', id), { screenplayUrl: '', screenplayName: '' })
    await deleteAllScenes()
    setParsedScenes(null)
    setImportSuccess(false)
  }

  async function togglePublic() {
    if (!id || !production) return
    await updateDoc(doc(db, 'productions', id), { isPublic: !production.isPublic })
  }

  async function addCollaborator() {
    if (!id || !addCollabEmail.trim() || !production) return
    setAddCollabError('')
    setAddingCollab(true)
    try {
      const term = addCollabEmail.trim().toLowerCase()
      const snap = await getDocs(query(collection(db, 'users'), fsWhere('email', '==', term)))
      const snap2 = snap.empty
        ? await getDocs(query(collection(db, 'users'), fsWhere('displayName', '==', addCollabEmail.trim())))
        : snap
      const user = snap2.empty ? null : { id: snap2.docs[0].id, ...snap2.docs[0].data() } as UserDoc & { id: string }
      if (!user) { setAddCollabError('User not found on the platform'); setAddingCollab(false); return }
      if (allCollabIds.includes(user.id)) { setAddCollabError('Already a collaborator'); setAddingCollab(false); return }
      await updateDoc(doc(db, 'productions', id), { collaborators: arrayUnion(user.id) })
      setAddCollabEmail('')
    } finally {
      setAddingCollab(false)
    }
  }

  async function shareTeam(team: ProductionTeamDoc) {
    if (!id || !production) return
    const alreadyShared = (production.sharedTeams ?? []).some(t => t.teamId === team.id)
    if (alreadyShared) return
    const memberViewers = (team.memberIds ?? []).filter(uid => !allCollabIds.includes(uid))
    const updates: Record<string, any> = {
      sharedTeams: arrayUnion({ teamId: team.id, teamName: team.name }),
    }
    if (memberViewers.length > 0) {
      updates.viewerIds = arrayUnion(...memberViewers)
    }
    await updateDoc(doc(db, 'productions', id), updates)
  }

  async function unshareTeam(teamId: string, teamName: string) {
    if (!id || !production) return
    await updateDoc(doc(db, 'productions', id), {
      sharedTeams: arrayRemove({ teamId, teamName }),
    })
  }

  async function linkPeriod(periodId: string) {
    if (!id) return
    await updateDoc(doc(db, 'productions', id), { periodId })
  }

  async function unlinkPeriod() {
    if (!id) return
    await updateDoc(doc(db, 'productions', id), { periodId: '' })
  }

  async function deleteProduction() {
    if (!id || !confirm('Delete this production? This cannot be undone.')) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'productions', id))
      navigate(backUrl)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (!production) return (
    <div className="text-center py-20 text-zinc-500">
      Production not found. <Link to={backUrl} className="text-brand-500 underline">Go back</Link>
    </div>
  )

  const lastEditor = allCohortUsers.find(u => u.id === production.lastEditedBy)
  const sharedTeamIds = new Set((production.sharedTeams ?? []).map(t => t.teamId))
  const unsharedTeams = cohortTeams.filter(t => !sharedTeamIds.has(t.id))

  return (
    <div className={cn('space-y-0 min-h-full', showFeedback && 'lg:pr-80')}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-5">
        {/* Top row: back + actions */}
        <div className="flex items-center gap-2 mb-3">
          <Link to={backUrl} className="p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-xl transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            {titleEditing && canEdit ? (
              <input
                autoFocus
                value={titleVal}
                onChange={e => setTitleVal(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setTitleEditing(false) }}
                className="text-xl font-bold bg-zinc-800 text-zinc-100 rounded-xl px-3 py-1 w-full focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            ) : (
              <h1
                className={cn('text-xl font-bold text-zinc-100 truncate', canEdit && 'cursor-pointer hover:text-brand-400 transition-colors')}
                onClick={() => { if (canEdit) { setTitleVal(production.title); setTitleEditing(true) } }}
              >
                {production.title}
              </h1>
            )}
          </div>

          {/* Actions row — scrollable on small screens */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Visibility */}
            {canEdit && isOwner && (
              <button
                onClick={togglePublic}
                title={production.isPublic ? 'Shared — click to make private' : 'Private — click to share'}
                className={cn(
                  'flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-medium border transition-colors',
                  production.isPublic
                    ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-400'
                    : 'bg-zinc-800 border-white/10 text-zinc-400 hover:text-zinc-200',
                )}
              >
                {production.isPublic ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{production.isPublic ? 'Shared' : 'Private'}</span>
              </button>
            )}

            {/* Share / Collaborators */}
            <div className="relative">
              <button
                onClick={() => { setShowCollabs(v => !v); setShowExports(false) }}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-medium bg-zinc-800 border border-white/10 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Share</span>
                <ChevronDown className={cn('w-3 h-3 transition-transform', showCollabs && 'rotate-180')} />
              </button>

              {showCollabs && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-zinc-900 border border-white/10 rounded-2xl shadow-xl p-4 space-y-4 z-30">
                  {/* Editors section */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-brand-400" />
                      <p className="text-xs font-semibold text-zinc-300">Editors</p>
                      <span className="text-[10px] text-zinc-500 ml-auto">can edit</span>
                    </div>
                    <div className="space-y-1.5">
                      {allCollabIds.map(uid => (
                        <CollaboratorRow
                          key={uid}
                          productionId={id!}
                          uid={uid}
                          isCreator={uid === production.createdBy}
                          canRemove={canEdit && isOwner}
                        />
                      ))}
                    </div>
                    {canEdit && isOwner && (
                      <div className="space-y-1.5 pt-1 border-t border-white/10">
                        <input
                          value={addCollabEmail}
                          onChange={e => { setAddCollabEmail(e.target.value); setAddCollabError('') }}
                          onKeyDown={e => e.key === 'Enter' && addCollaborator()}
                          className="input w-full text-sm"
                          placeholder="Name or email to add editor…"
                        />
                        {addCollabError && <p className="text-xs text-rose-400">{addCollabError}</p>}
                        <button
                          onClick={addCollaborator}
                          disabled={addingCollab || !addCollabEmail.trim()}
                          className="btn-primary w-full py-1.5 text-xs disabled:opacity-40"
                        >
                          {addingCollab ? 'Adding…' : 'Add Editor'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Team viewers section */}
                  {canEdit && isOwner && (
                    <div className="space-y-2 border-t border-white/10 pt-3">
                      <div className="flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5 text-amber-400" />
                        <p className="text-xs font-semibold text-zinc-300">Team Viewers</p>
                        <span className="text-[10px] text-zinc-500 ml-auto">view only</span>
                      </div>

                      {/* Currently shared teams */}
                      {(production.sharedTeams ?? []).length > 0 && (
                        <div className="space-y-1">
                          {(production.sharedTeams ?? []).map(t => (
                            <div key={t.teamId} className="flex items-center gap-2 bg-amber-950/20 border border-amber-900/30 rounded-lg px-2.5 py-1.5">
                              <span className="text-xs text-amber-300 flex-1">{t.teamName}</span>
                              <button
                                onClick={() => unshareTeam(t.teamId, t.teamName)}
                                className="text-zinc-500 hover:text-rose-400 transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add team */}
                      {unsharedTeams.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] text-zinc-500">Share with a team:</p>
                          {unsharedTeams.map(team => (
                            <button
                              key={team.id}
                              onClick={() => shareTeam(team)}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800/60 hover:bg-zinc-800 rounded-lg text-xs text-zinc-300 transition-colors"
                            >
                              <span>{team.emoji}</span>
                              <span className="flex-1 text-left">{team.name}</span>
                              <span className="text-zinc-500">{team.memberIds?.length ?? 0} members</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {unsharedTeams.length === 0 && (production.sharedTeams ?? []).length === 0 && (
                        <p className="text-xs text-zinc-500">No teams in your cohort yet.</p>
                      )}
                    </div>
                  )}

                  {/* Production Period */}
                  {(canEdit || isTeacherOrAdmin) && productionPeriods.length > 0 && (
                    <div className="space-y-2 border-t border-white/10 pt-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-brand-400 text-xs">📅</span>
                        <p className="text-xs font-semibold text-zinc-300">Production Period</p>
                      </div>
                      {production.periodId ? (
                        <div className="flex items-center gap-2 bg-brand-950/30 border border-brand-800/40 rounded-lg px-2.5 py-1.5">
                          <span className="text-xs text-brand-300 flex-1">
                            {productionPeriods.find(p => p.id === production.periodId)?.title ?? 'Unknown period'}
                          </span>
                          <button onClick={unlinkPeriod} className="text-zinc-500 hover:text-rose-400 transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-[10px] text-zinc-500">Add to a production period:</p>
                          {productionPeriods.map(period => (
                            <button
                              key={period.id}
                              onClick={() => linkPeriod(period.id)}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800/60 hover:bg-zinc-800 rounded-lg text-xs text-zinc-300 transition-colors text-left"
                            >
                              <span className="flex-1">{period.title}</span>
                              <span className="text-zinc-500 text-[10px]">{period.startDate} – {period.endDate}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {!production.periodId && (
                        <p className="text-[10px] text-zinc-600">Productions not linked to a period are hidden from the production schedule.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Export PDF */}
            <button
              onClick={async () => {
                if (exportingPdf) return
                setExportingPdf(true)
                try {
                  const fn = httpsCallable<{ productionId: string }, { pdf: string }>(functions, 'exportProductionPdf')
                  const result = await fn({ productionId: id! })
                  const bytes = Uint8Array.from(atob(result.data.pdf), c => c.charCodeAt(0))
                  const blob  = new Blob([bytes], { type: 'application/pdf' })
                  const url   = URL.createObjectURL(blob)
                  const a     = document.createElement('a')
                  a.href      = url
                  a.download  = `${production.title.replace(/[^a-z0-9]/gi, '_')}_production.pdf`
                  a.click()
                  URL.revokeObjectURL(url)
                } finally { setExportingPdf(false) }
              }}
              disabled={exportingPdf}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-medium bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors disabled:opacity-50"
              title="Export PDF"
            >
              {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{exportingPdf ? 'Exporting…' : 'PDF'}</span>
            </button>

            {/* Export XLS */}
            <button
              disabled={exportingXls}
              onClick={async () => {
                setExportingXls(true)
                try { await exportXLS(production, scenes, cast, shots, shootingDays, crewAssignments, locations) }
                catch (e) { console.error('XLS export failed:', e); alert('Export failed — see console for details.') }
                finally { setExportingXls(false) }
              }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-900/40 transition-colors disabled:opacity-50"
              title="Export XLSX"
            >
              {exportingXls ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{exportingXls ? 'Exporting…' : 'Export Breakdown'}</span>
            </button>

            {/* Teacher feedback */}
            {isTeacherOrAdmin && (
              <button
                onClick={() => setShowFeedback(v => !v)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-medium border transition-colors',
                  showFeedback
                    ? 'bg-brand-600 border-brand-500 text-white'
                    : 'bg-zinc-800 border-white/10 text-zinc-400 hover:text-zinc-200',
                )}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Feedback</span>
              </button>
            )}

            {/* Delete */}
            {(isOwner || isTeacherOrAdmin) && (
              <button
                onClick={deleteProduction}
                disabled={deleting}
                className="p-2 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-xl transition-colors"
                title="Delete production"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-xs text-zinc-500 ml-11 flex-wrap">
          {production.updatedAt && (
            <span>Updated {relTime(production.updatedAt)}{lastEditor ? ` by ${lastEditor.displayName}` : ''}</span>
          )}
          {!canEdit && <span className="text-amber-500">View only</span>}
          {(production.sharedTeams ?? []).length > 0 && (
            <span className="text-amber-500/70">{production.sharedTeams.map(t => t.teamName).join(', ')} can view</span>
          )}
        </div>
      </div>


      {/* ── Tabs — horizontally scrollable on mobile ─────────────── */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 mb-6">
        <div className="flex gap-1 bg-zinc-800/60 p-1 rounded-xl w-max">
          {readiness.isReady && !isTeacherOrAdmin && (
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <p className="font-semibold text-white">Production plan complete!</p>
                  <p className="text-sm text-gray-400">You can now book equipment for this production.</p>
                </div>
              </div>
              <a href="/booking/equipment" className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
                Book Equipment →
              </a>
            </div>
          )}
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
                activeTab === t.id ? 'bg-brand-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────── */}
      <div>
        {activeTab === 'script' && (
          <div>
            {/* ── File bar (when script is uploaded) ── */}
            {production.screenplayUrl ? (
              <div className="mb-4 space-y-3">
                <div className="flex items-center gap-2 bg-zinc-800/60 border border-white/10 rounded-xl px-3 py-2 flex-wrap">
                  <FileText className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span className="text-sm text-zinc-200 truncate flex-1 min-w-0" title={production.screenplayName}>
                    {production.screenplayName ?? 'Screenplay'}
                  </span>
                  {/* Open in new tab — works on all platforms including iOS */}
                  <a
                    href={production.screenplayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 bg-zinc-700/50 rounded-lg flex-shrink-0"
                  >
                    Open
                  </a>
                  {canEdit && (
                    <>
                      <label className="cursor-pointer p-1 text-zinc-500 hover:text-zinc-200 transition-colors flex-shrink-0" title="Replace screenplay">
                        <Upload className="w-3.5 h-3.5" />
                        <input type="file" accept="application/pdf" className="hidden" onChange={e => e.target.files?.[0] && uploadScreenplay(e.target.files[0])} />
                      </label>
                      <button onClick={removeScreenplay} className="p-1 text-zinc-500 hover:text-rose-400 transition-colors flex-shrink-0" title="Remove screenplay">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Status messages */}
                {(uploadProgress !== null || parsing || importSuccess || (parsedScenes && !showImportModal && !importSuccess && parsedScenes.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-3">
                    {uploadProgress !== null && (
                      <div className="flex items-center gap-2">
                        <div className="w-28 h-1 bg-zinc-700 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                        </div>
                        <span className="text-xs text-zinc-400 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> {uploadProgress}%
                        </span>
                      </div>
                    )}
                    {parsing && (
                      <span className="flex items-center gap-1.5 text-xs text-brand-400">
                        <Loader2 className="w-3 h-3 animate-spin" /> Parsing screenplay…
                      </span>
                    )}
                    {importSuccess && (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" /> Scenes imported to Script Breakdown
                      </span>
                    )}
                    {parsedScenes && !showImportModal && !importSuccess && parsedScenes.length > 0 && (
                      <button onClick={() => setShowImportModal(true)} className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors">
                        <Sparkles className="w-3 h-3" /> Import {parsedScenes.length} detected scenes
                      </button>
                    )}
                  </div>
                )}

                {/* PDF preview — iframe on desktop, tap-to-open card on mobile */}
                <iframe
                  src={production.screenplayUrl}
                  title="Screenplay"
                  className="hidden md:block w-full rounded-xl border border-white/10 bg-zinc-900"
                  style={{ height: '78vh' }}
                />
                <a
                  href={production.screenplayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="md:hidden flex items-center gap-3 w-full bg-zinc-800/60 border border-white/10 rounded-2xl px-5 py-6 text-left hover:bg-zinc-800 transition-colors"
                >
                  <FileText className="w-8 h-8 text-rose-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Open screenplay</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Tap to read in your PDF viewer</p>
                  </div>
                </a>
              </div>
            ) : canEdit ? (
              /* ── Empty state upload zone ── */
              <div className="w-full flex flex-col items-center justify-center" style={{ minHeight: '50vh' }}>
                {(uploadProgress !== null || parsing) && (
                  <div className="mb-4 flex flex-col items-center gap-2">
                    {uploadProgress !== null && (
                      <div className="flex items-center gap-2">
                        <div className="w-32 h-1 bg-zinc-700 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                        </div>
                        <span className="text-xs text-zinc-400">{uploadProgress}%</span>
                      </div>
                    )}
                    {parsing && (
                      <span className="flex items-center gap-1.5 text-xs text-brand-400">
                        <Loader2 className="w-3 h-3 animate-spin" /> Parsing screenplay…
                      </span>
                    )}
                  </div>
                )}
                <label
                  className={cn(
                    'cursor-pointer flex flex-col items-center gap-3 border-2 border-dashed rounded-2xl px-6 py-8 md:px-12 md:py-10 transition-colors text-center w-full max-w-sm md:max-w-md',
                    dragOver
                      ? 'border-brand-500 bg-brand-500/10 scale-[1.02]'
                      : 'border-white/10 hover:border-brand-500/50 group',
                  )}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOver(false)
                    const file = e.dataTransfer.files[0]
                    if (file?.type === 'application/pdf') uploadScreenplay(file)
                  }}
                >
                  <FileText className={cn('w-10 h-10 transition-colors', dragOver ? 'text-brand-400' : 'text-zinc-600 group-hover:text-brand-400')} />
                  <div>
                    <p className={cn('text-base font-medium transition-colors', dragOver ? 'text-white' : 'text-zinc-300 group-hover:text-white')}>
                      {dragOver ? 'Drop to upload' : 'Upload screenplay'}
                    </p>
                    <p className="text-sm text-zinc-500 mt-1 hidden md:block">Drag & drop or tap — PDF format</p>
                    <p className="text-sm text-zinc-500 mt-1 md:hidden">Tap to select a PDF</p>
                  </div>
                  <input type="file" accept="application/pdf" className="hidden" onChange={e => e.target.files?.[0] && uploadScreenplay(e.target.files[0])} />
                </label>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No screenplay uploaded yet.</p>
            )}
          </div>
        )}
        {activeTab === 'breakdown' && <BreakdownTab productionId={id!} canEdit={canEdit} />}
        {activeTab === 'crew'      && <CrewTab      productionId={id!} canEdit={canEdit} cohortUsers={allCohortUsers} />}
        {activeTab === 'cast'      && <CastTab      productionId={id!} canEdit={canEdit} />}
        {activeTab === 'shots'     && <ShotListTab  productionId={id!} canEdit={canEdit} />}
        {activeTab === 'locations' && <LocationsTab productionId={id!} canEdit={canEdit} />}
        {activeTab === 'schedule'  && <ScheduleTab  productionId={id!} canEdit={canEdit} productionTitle={production.title} />}
        {activeTab === 'shotlog'   && (
          <ShotLogTab
            productionId={id!}
            productionTitle={production.title}
            scenes={scenes}
            shots={shots}
            shootingDays={shootingDays}
            canEdit={canEdit}
          />
        )}
        {activeTab === 'budget' && (
          <BudgetTab
            productionId={id!}
            crewAssignments={crewAssignments}
            shootingDays={shootingDays}
            budgetLimit={production.budgetLimit}
            productionType={production.productionType}
            canEdit={canEdit}
          />
        )}
      </div>

      {/* ── Teacher feedback panel ───────────────────────────────── */}
      {showFeedback && isTeacherOrAdmin && (
        <FeedbackPanel
          productionId={id!}
          tab={activeTab}
          onClose={() => setShowFeedback(false)}
        />
      )}

      {/* Close dropdowns on outside click */}
      {showCollabs && (
        <div className="fixed inset-0 z-20" onClick={() => setShowCollabs(false)} />
      )}

      {/* ── Screenplay import modal ──────────────────────────────────── */}
      {showImportModal && parsedScenes && (
        <SceneImportModal
          scenes={parsedScenes}
          importing={importing}
          onImport={handleImportScenes}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  )
}

// ── SceneImportModal ──────────────────────────────────────────────────────────
function SceneImportModal({
  scenes, importing, onImport, onClose,
}: {
  scenes: ParsedScene[]
  importing: boolean
  onImport: (selected: ParsedScene[]) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(scenes.map((_, i) => i)))

  function toggle(i: number) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const selectedScenes = scenes.filter((_, i) => selected.has(i))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-400" />
            <h2 className="font-semibold text-white">Import Scenes from Screenplay</h2>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="px-4 pt-3 text-xs text-zinc-400">
          {scenes.length} scene heading{scenes.length !== 1 ? 's' : ''} detected. Select which to import into Script Breakdown.
        </p>

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {scenes.map((scene, i) => (
            <label
              key={i}
              className={cn(
                'flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-colors border',
                selected.has(i)
                  ? 'bg-brand-500/10 border-brand-500/30'
                  : 'bg-zinc-800/40 border-transparent hover:bg-zinc-800/70',
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggle(i)}
                className="mt-0.5 accent-brand-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-mono bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-300 flex-shrink-0">{scene.intExt}</span>
                  <span className="text-[10px] text-zinc-500 flex-shrink-0">{scene.dayNight}</span>
                </div>
                <p className="text-sm text-zinc-200 font-medium">{scene.location}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">{scene.headingRaw}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="p-4 border-t border-white/10 flex items-center justify-between gap-3">
          <button
            onClick={() => setSelected(selected.size === scenes.length ? new Set() : new Set(scenes.map((_, i) => i)))}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {selected.size === scenes.length ? 'Deselect all' : 'Select all'}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={() => onImport(selectedScenes)}
              disabled={importing || selectedScenes.length === 0}
              className="btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-40"
            >
              {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Import {selectedScenes.length} scene{selectedScenes.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
