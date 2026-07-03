import { useState, useMemo, useEffect } from 'react'
import { doc, updateDoc, addDoc, deleteDoc, collection, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type {
  ProductionShootingDayDoc, ProductionSceneDoc, ProductionCastDoc, LocationMove,
  ProductionCrewAssignmentDoc, ProductionLocationDoc, CrewRoleDoc, ProductionShotDoc,
} from '@/types'
import { Plus, Trash2, CalendarDays, X, AlertTriangle, MapPin, Check, Clock, FileSpreadsheet, Loader2, Bell } from 'lucide-react'
import { CallSheetPreviewModal, parseTime as _parseTime, getStartEnd as _getStartEnd } from '@/components/production/CallSheetPreviewModal'

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

function fmtPages(eighths: number): string {
  if (!eighths) return ''
  const whole = Math.floor(eighths / 8)
  const rem   = eighths % 8
  if (whole === 0) return `${rem}/8`
  if (rem   === 0) return `${whole}`
  return `${whole} ${rem}/8`
}

// ── Call sheet export ─────────────────────────────────────────────────────────
async function exportCallSheet(
  productionTitle: string,
  day: ProductionShootingDayDoc,
  dayNumber: number,
  totalDays: number,
  dayScenes: ProductionSceneDoc[],
  allCast: ProductionCastDoc[],
  crew: ProductionCrewAssignmentDoc[],
  crewRoles: CrewRoleDoc[],
  locations: ProductionLocationDoc[],
  shots: ProductionShotDoc[],
  sunriseSunset?: { sunrise: string; sunset: string; weather?: string; temp?: string },
) {
  const XLSX = await import('xlsx-js-style')
  const ws: any = {}
  const merges: any[] = []

  const GRAY = 'C0C0C0', WHITE = 'FFFFFF', BLACK = '000000'
  const thin = { style: 'thin', color: { rgb: BLACK } }
  const B = { top: thin, bottom: thin, left: thin, right: thin }

  function st(fill: string, bold: boolean, sz: number, halign = 'center', italic = false): any {
    return {
      fill: { patternType: 'solid', fgColor: { rgb: fill } },
      font: { name: 'Trebuchet MS', bold, sz, color: { rgb: BLACK }, italic },
      alignment: { horizontal: halign, vertical: 'center', wrapText: true },
      border: B,
    }
  }

  function cell(r: number, col: number, v: any, s: any) {
    const ref = XLSX.utils.encode_cell({ r, c: col })
    ws[ref] = { t: typeof v === 'number' && !isNaN(Number(v)) ? 'n' : 's', v: v ?? '', s }
  }
  function merge(r1: number, c1: number, r2: number, c2: number) {
    merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } })
  }
  function fill(r1: number, c1: number, r2: number, c2: number, s: any) {
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) {
        const ref = XLSX.utils.encode_cell({ r, c })
        if (!ws[ref]) ws[ref] = { t: 's', v: '', s }
      }
  }

  const hdr      = st(GRAY,  true,  11, 'center')
  const white    = st(WHITE, false, 10, 'center')
  const whiteL   = st(WHITE, false, 10, 'left')
  const whiteB   = st(WHITE, true,  10, 'center')
  const whiteSm  = st(WHITE, false,  9, 'left')
  const whiteSmB = st(WHITE, true,   9, 'left')
  const titleSt  = st(GRAY,  true,  18, 'center')
  const callSt   = st(WHITE, true,  24, 'center')
  const noteSt   = st(WHITE, false, 10, 'center')
  const sep      = { fill: { patternType: 'solid', fgColor: { rgb: WHITE } }, font: { name: 'Trebuchet MS', sz: 9 }, border: { bottom: thin } }
  const sepH     = { fill: { patternType: 'solid', fgColor: { rgb: WHITE } }, font: { name: 'Trebuchet MS', sz: 9 }, border: { top: thin, bottom: thin } }

  const dateStr = day.date
    ? new Date(day.date + 'T12:00:00').toLocaleDateString('en-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
  const { startTime, endTime } = getStartEnd(day)
  const callTime = startTime || '—'                // crew call = start of day
  const rts      = day.rtsTime || startTime || '—' // RTS = camera roll time
  const sMin = parseTime(startTime), eMin = parseTime(endTime)
  const lunchMin = day.lunchDuration ?? 0
  const workHrsStr = sMin !== null && eMin !== null
    ? `${(((eMin - sMin) - lunchMin) / 60).toFixed(1)} H${lunchMin ? ` (${lunchMin} min lunch)` : ''}`
    : (day.workHours || '—')
  const daysCastIds = new Set(dayScenes.flatMap(s => s.castIds ?? []))
  const daysCast = allCast.filter(c => daysCastIds.has(c.castId)).sort((a, b) => a.castId - b.castId)

  // Build lookup maps
  const locById = Object.fromEntries(locations.map(l => [l.id, l]))

  // Sort crew by role order
  const orderedRoleIds = crewRoles.map(r => r.id)
  const crewInOrder: ProductionCrewAssignmentDoc[] = [
    ...crewRoles.map(role => crew.find(c => c.roleId === role.id)).filter(Boolean) as ProductionCrewAssignmentDoc[],
    ...crew.filter(c => !orderedRoleIds.includes(c.roleId ?? '')),
  ]

  let r = 0

  // ── Row 0: Title bar ──────────────────────────────────────────────────────
  cell(r, 0, 'CALL SHEET', st(WHITE, true, 13)); merge(r, 0, r, 3); fill(r, 0, r, 3, st(WHITE, true, 13))
  fill(r, 4, r, 11, st(WHITE, false, 9))
  cell(r, 12, `Shoot Date:  ${dateStr}`, whiteSmB); merge(r, 12, r, 13); fill(r, 12, r, 13, whiteSmB)
  cell(r, 14, `Day ${dayNumber} of ${totalDays}`, whiteB); merge(r, 14, r, 15); fill(r, 14, r, 15, whiteB)
  r++

  // ── Row 1: thin separator ─────────────────────────────────────────────────
  for (let c = 0; c < 16; c++) cell(r, c, '', sep)
  r++

  // ── Rows 2-7: Info block ──────────────────────────────────────────────────
  const infoR = r
  const producers   = crewInOrder.filter(c => (c.roleName ?? '').toLowerCase().includes('producer') && c.assignedName)
  const directorCrew = crewInOrder.find(c => (c.roleName ?? '').toLowerCase() === 'director')
  const infoLeftRows = [
    { lbl: producers[0]?.roleName || 'Producer', val: producers[0]?.assignedName ?? '' },
    { lbl: producers[1]?.roleName || 'Producer 2', val: producers[1]?.assignedName ?? '' },
    { lbl: 'Director', val: directorCrew?.assignedName ?? '' },
  ]
  infoLeftRows.forEach(({ lbl, val }, i) => {
    cell(r + i, 0, lbl, whiteSmB)
    cell(r + i, 1, val, whiteSm); merge(r + i, 1, r + i, 2); fill(r + i, 1, r + i, 2, whiteSm)
    cell(r + i, 3, '', whiteSm)
  })
  cell(r + 3, 0, 'Nearest Hospital', whiteSmB); merge(r + 3, 0, r + 3, 2); fill(r + 3, 0, r + 3, 2, whiteSmB)
  cell(r + 3, 3, '', whiteSm)
  cell(r + 4, 0, '', whiteL); merge(r + 4, 0, r + 4, 3); fill(r + 4, 0, r + 4, 3, whiteL)
  cell(r + 5, 0, '', whiteL); merge(r + 5, 0, r + 5, 3); fill(r + 5, 0, r + 5, 3, whiteL)
  cell(infoR, 5, productionTitle, titleSt); merge(infoR, 5, infoR + 5, 10); fill(infoR, 5, infoR + 5, 10, titleSt)
  fill(infoR, 11, infoR + 5, 11, { ...whiteSm, border: { right: thin } })
  const sched: [string, string][] = [
    ['RTS', rts],
    ['EST. WRAP', endTime || '—'],
    ['SUNRISE', 'SUNSET'],
    [sunriseSunset?.sunrise ?? '—', sunriseSunset?.sunset ?? '—'],
    ['WORKING DAY', 'WEATHER'],
    [workHrsStr, [sunriseSunset?.weather, sunriseSunset?.temp].filter(Boolean).join('  ')],
  ]
  sched.forEach(([l, rv], i) => {
    cell(infoR + i, 12, l,  i % 2 === 0 ? whiteSmB : whiteSm); merge(infoR + i, 12, infoR + i, 13)
    cell(infoR + i, 14, rv, i % 2 === 0 ? whiteSmB : whiteSm); merge(infoR + i, 14, infoR + i, 15)
  })
  r += 6

  // ── Row 8: separator ──────────────────────────────────────────────────────
  for (let c = 0; c < 16; c++) cell(r, c, '', sepH)
  r++

  // ── Rows 9-12: CALL block ─────────────────────────────────────────────────
  cell(r, 0, 'Call times may vary. Contact 1st AD for details.', noteSt); merge(r, 0, r + 3, 4); fill(r, 0, r + 3, 4, noteSt)
  fill(r, 5, r + 3, 5, { ...white, border: { left: thin, right: thin } })
  cell(r, 6, 'CALL',     callSt); merge(r, 6, r + 3, 7); fill(r, 6, r + 3, 7, callSt)
  cell(r, 8, callTime,   callSt); merge(r, 8, r + 3, 9); fill(r, 8, r + 3, 9, callSt)
  fill(r, 10, r + 3, 10, { ...white, border: { left: thin, right: thin } })
  cell(r, 11, day.notes || '', noteSt); merge(r, 11, r + 3, 15); fill(r, 11, r + 3, 15, noteSt)
  r += 4

  // ── Rows 13-14: separators ────────────────────────────────────────────────
  for (let i = 0; i < 2; i++) { for (let c = 0; c < 16; c++) cell(r, c, '', sep); r++ }

  // ── Row 15: scene table headers ───────────────────────────────────────────
  cell(r, 0,  'SCENES',              hdr)
  cell(r, 1,  'SET AND DESCRIPTION', hdr); merge(r, 1, r, 6); fill(r, 1, r, 6, hdr)
  cell(r, 7,  'CHARACTER #',         hdr); merge(r, 7, r, 8); fill(r, 7, r, 8, hdr)
  cell(r, 9,  'D/N',                 hdr)
  cell(r, 10, 'PAGES',               hdr)
  cell(r, 11, 'LOCATION / ADDRESS',  hdr); merge(r, 11, r, 15); fill(r, 11, r, 15, hdr)
  r++

  // ── Scene rows (2 rows per scene) + location moves ───────────────────────
  const movesMap = Object.fromEntries((day.locationMoves ?? []).map(m => [m.afterSceneId, m]))
  const moveSt   = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FFF3CD' } },
    font: { name: 'Trebuchet MS', bold: true, sz: 9, color: { rgb: '92400E' } },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: false },
    border: B,
  }
  const italicSt = { ...whiteL, font: { name: 'Trebuchet MS', bold: false, sz: 10, italic: true, color: { rgb: BLACK } } }

  // First render real scenes with their moves
  dayScenes.forEach((sc, i) => {
    const castNums = (sc.castIds ?? []).join(', ')
    const scLoc    = sc.locationId ? locById[sc.locationId] : null
    const addrCell = scLoc
      ? [scLoc.address, scLoc.zipCode, scLoc.state].filter(Boolean).join(', ') || sc.intExt
      : sc.intExt

    cell(r, 0, sc.sceneNumber,                  whiteB); merge(r, 0, r + 1, 0); fill(r, 0, r + 1, 0, whiteB)
    cell(r, 1, (sc.location ?? '').toUpperCase(), whiteB); merge(r, 1, r, 6); fill(r, 1, r, 6, whiteB)
    cell(r, 7, castNums, white); merge(r, 7, r, 8)
    cell(r, 9, sc.dayNight === 'Night' ? 'N' : 'D', white)
    cell(r, 10, sc.pages ? fmtPages(sc.pages) : '', white)
    cell(r, 11, addrCell, white); merge(r, 11, r, 15); fill(r, 11, r, 15, white)
    cell(r + 1, 1, sc.description ?? '', italicSt); merge(r + 1, 1, r + 1, 10); fill(r + 1, 1, r + 1, 10, italicSt)
    cell(r + 1, 11, sc.intExt, white); merge(r + 1, 11, r + 1, 15); fill(r + 1, 11, r + 1, 15, white)
    r += 2

    // Location move after this scene
    const move = movesMap[sc.id]
    if (move) {
      const moveLabel = `⟶  LOCATION MOVE  ·  ${move.minutes} min${move.note ? `  ·  ${move.note}` : ''}`
      cell(r, 0, moveLabel, moveSt); merge(r, 0, r, 15); fill(r, 0, r, 15, moveSt)
      r++
    }
  })

  // Pad to at least 5 scene slots if fewer scenes
  const padSlots = Math.max(5 - dayScenes.length, 0)
  for (let i = 0; i < padSlots; i++) {
    cell(r, 0, '', whiteB); merge(r, 0, r + 1, 0); fill(r, 0, r + 1, 0, whiteB)
    cell(r, 1, '', whiteB); merge(r, 1, r, 6); fill(r, 1, r, 6, whiteB)
    cell(r, 7, '', white); merge(r, 7, r, 8)
    cell(r, 9, '', white)
    cell(r, 10, '', white)
    cell(r, 11, '', white); merge(r, 11, r, 15); fill(r, 11, r, 15, white)
    cell(r + 1, 1, '', italicSt); merge(r + 1, 1, r + 1, 10); fill(r + 1, 1, r + 1, 10, italicSt)
    cell(r + 1, 11, '', white); merge(r + 1, 11, r + 1, 15); fill(r + 1, 11, r + 1, 15, white)
    r += 2
  }

  // ── Total pages ───────────────────────────────────────────────────────────
  const totalEighths = dayScenes.reduce((s, sc) => s + (sc.pages ?? 0), 0)
  for (let c = 0; c < 9; c++) cell(r, c, '', { ...white, border: { top: thin } })
  cell(r, 9, 'TOTAL PAGES', hdr); merge(r, 9, r, 10); fill(r, 9, r, 10, hdr)
  cell(r, 11, totalEighths ? fmtPages(totalEighths) : '', white); merge(r, 11, r, 15); fill(r, 11, r, 15, white)
  r++

  // ── Separator ────────────────────────────────────────────────────────────
  for (let c = 0; c < 16; c++) cell(r, c, '', sep)
  r++

  // ── Cast headers ─────────────────────────────────────────────────────────
  cell(r, 0,  '#',                    hdr)
  cell(r, 1,  'CHARACTER',            hdr); merge(r, 1, r, 2);   fill(r, 1, r, 2, hdr)
  cell(r, 3,  'ACTOR / ACTRESS',      hdr); merge(r, 3, r, 6);   fill(r, 3, r, 6, hdr)
  cell(r, 7,  'SWHF',                 hdr)
  cell(r, 8,  'MU',                   hdr)
  cell(r, 9,  'SET',                  hdr); merge(r, 9, r, 10);  fill(r, 9, r, 10, hdr)
  cell(r, 11, 'MINOR?',               hdr)
  cell(r, 12, 'SPECIAL INSTRUCTIONS', hdr); merge(r, 12, r, 15); fill(r, 12, r, 15, hdr)
  r++

  // ── Cast rows ────────────────────────────────────────────────────────────
  const castSlots = Math.max(daysCast.length, 5)
  for (let i = 0; i < castSlots; i++) {
    const cd = daysCast[i]
    cell(r, 0,  cd ? cd.castId        : '', white)
    cell(r, 1,  cd ? cd.characterName : '', white); merge(r, 1, r, 2);   if (!cd) fill(r, 1, r, 2, white)
    cell(r, 3,  cd ? cd.actorName     : '', white); merge(r, 3, r, 6);   if (!cd) fill(r, 3, r, 6, white)
    cell(r, 7,  '', white)
    cell(r, 8,  '', white)
    cell(r, 9,  cd && rts !== '—' ? rts : '', white); merge(r, 9, r, 10)
    cell(r, 11, '', white)
    cell(r, 12, '', white); merge(r, 12, r, 15); fill(r, 12, r, 15, white)
    r++
  }

  // ── Separator ────────────────────────────────────────────────────────────
  for (let c = 0; c < 16; c++) cell(r, c, '', sepH)
  r++

  // ── Production notes ─────────────────────────────────────────────────────
  cell(r, 0, 'PRODUCTION NOTES', hdr); merge(r, 0, r, 15); fill(r, 0, r, 15, hdr)
  r++
  cell(r, 0, '', noteSt); merge(r, 0, r + 3, 7);  fill(r, 0, r + 3, 7,  noteSt)
  cell(r, 8, '', noteSt); merge(r, 8, r + 3, 15); fill(r, 8, r + 3, 15, noteSt)
  r += 4

  // ── Separator ────────────────────────────────────────────────────────────
  for (let c = 0; c < 16; c++) cell(r, c, '', sepH)
  r++

  // ── Crew table (dynamic, from production crew — no phone/in) ──────────────
  cell(r, 0,  'POSITION', hdr); merge(r, 0,  r, 3);  fill(r, 0,  r, 3,  hdr)
  cell(r, 4,  'NAME',     hdr); merge(r, 4,  r, 7);  fill(r, 4,  r, 7,  hdr)
  cell(r, 8,  '',  { ...hdr, fill: { patternType: 'solid', fgColor: { rgb: WHITE } } })
  cell(r, 9,  'POSITION', hdr); merge(r, 9,  r, 11); fill(r, 9,  r, 11, hdr)
  cell(r, 12, 'NAME',     hdr); merge(r, 12, r, 15); fill(r, 12, r, 15, hdr)
  r++

  const half = Math.max(Math.ceil(crewInOrder.length / 2), 10)
  for (let i = 0; i < half; i++) {
    const left  = crewInOrder[i]
    const right = crewInOrder[half + i]
    const sep8  = { fill: { patternType: 'solid', fgColor: { rgb: WHITE } }, font: { name: 'Trebuchet MS', sz: 9 }, border: { left: thin, right: thin } }
    cell(r + i, 0,  left?.roleName      ?? '', whiteSmB); merge(r + i, 0,  r + i, 3)
    cell(r + i, 4,  left?.assignedName  ?? '', whiteSm);  merge(r + i, 4,  r + i, 7)
    cell(r + i, 8,  '', sep8)
    cell(r + i, 9,  right?.roleName     ?? '', whiteSmB); merge(r + i, 9,  r + i, 11)
    cell(r + i, 12, right?.assignedName ?? '', whiteSm);  merge(r + i, 12, r + i, 15)
    fill(r + i, 0, r + i, 3, whiteSmB)
    fill(r + i, 4, r + i, 7, whiteSm)
    fill(r + i, 9, r + i, 11, whiteSmB)
    fill(r + i, 12, r + i, 15, whiteSm)
  }
  r += half

  // ── Footer ────────────────────────────────────────────────────────────────
  for (let c = 0; c < 16; c++) cell(r, c, '', { ...white, border: { top: thin } })
  r++
  cell(r, 0, `Generated by CineForge · ${productionTitle} · ${dateStr}`, { fill: { patternType: 'solid', fgColor: { rgb: WHITE } }, font: { name: 'Trebuchet MS', sz: 8, color: { rgb: BLACK } }, alignment: { horizontal: 'center', vertical: 'center' } })
  merge(r, 0, r, 15)
  r++

  ws['!ref'] = `A1:P${r}`
  ws['!cols'] = [14, 8, 8, 14, 9, 8, 8, 8, 8, 8, 8, 9, 14, 10, 11, 14].map(w => ({ wch: w }))
  ws['!rows'] = Array(r).fill({ hpt: 17.25 })
  ws['!merges'] = merges

  for (let ri = 0; ri < r; ri++)
    for (let ci = 0; ci < 16; ci++) {
      const ref = XLSX.utils.encode_cell({ r: ri, c: ci })
      if (!ws[ref]) ws[ref] = { t: 's', v: '', s: { fill: { patternType: 'solid', fgColor: { rgb: WHITE } } } }
    }

  // ── Shot List sheet ───────────────────────────────────────────────────────
  const daySceneIds = new Set(dayScenes.map(s => s.id))
  const dayShots = shots.filter(sh => daySceneIds.has(sh.sceneId))
  const slWs: any = {}
  const slMerges: any[] = []
  const slHdr = {
    fill: { patternType: 'solid', fgColor: { rgb: GRAY } },
    font: { name: 'Trebuchet MS', bold: true, sz: 9, color: { rgb: BLACK } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: B,
  }
  const slCell = {
    fill: { patternType: 'solid', fgColor: { rgb: WHITE } },
    font: { name: 'Trebuchet MS', bold: false, sz: 9, color: { rgb: BLACK } },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
    border: B,
  }
  const slCols = ['SCENE #', 'SHOT #', 'SUBJECT', 'SIZE', 'ANGLE', 'MOVEMENT', 'NOTES']
  slCols.forEach((h, ci) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c: ci })
    slWs[ref] = { t: 's', v: h, s: slHdr }
  })
  const sceneNumById = Object.fromEntries(dayScenes.map(s => [s.id, s.sceneNumber]))
  // Sort shots by scene order then shot number
  const orderedShots = [...dayShots].sort((a, b) => {
    const scA = dayScenes.findIndex(s => s.id === a.sceneId)
    const scB = dayScenes.findIndex(s => s.id === b.sceneId)
    if (scA !== scB) return scA - scB
    return a.shotNumber - b.shotNumber
  })
  orderedShots.forEach((sh, ri) => {
    const row = ri + 1
    const vals = [sceneNumById[sh.sceneId] ?? '', sh.shotNumber, sh.subject, sh.size, sh.angle, sh.movement, sh.notes ?? '']
    vals.forEach((v, ci) => {
      const ref = XLSX.utils.encode_cell({ r: row, c: ci })
      slWs[ref] = { t: typeof v === 'number' ? 'n' : 's', v: v ?? '', s: slCell }
    })
  })
  const slRowCount = orderedShots.length + 1
  slWs['!ref']  = `A1:G${slRowCount || 2}`
  slWs['!cols'] = [8, 8, 30, 12, 14, 16, 30].map(w => ({ wch: w }))
  slWs['!rows'] = Array(slRowCount).fill({ hpt: 17.25 })
  slWs['!merges'] = slMerges

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Call Sheet')
  XLSX.utils.book_append_sheet(wb, slWs, 'Shot List')
  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${productionTitle.replace(/[^a-z0-9]/gi, '_')}_callsheet_day${dayNumber}${day.date ? `_${day.date}` : ''}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

async function exportCallSheetPDF(
  productionTitle: string,
  day: ProductionShootingDayDoc,
  dayNumber: number,
  totalDays: number,
  dayScenes: ProductionSceneDoc[],
  allCast: ProductionCastDoc[],
  crew: ProductionCrewAssignmentDoc[],
  crewRoles: CrewRoleDoc[],
  locations: ProductionLocationDoc[],
  shots: ProductionShotDoc[],
  sunriseSunset?: { sunrise: string; sunset: string; weather?: string; temp?: string },
) {
  const { default: jsPDF } = await import('jspdf')

  const dateStr = day.date
    ? new Date(day.date + 'T12:00:00').toLocaleDateString('en-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
  const { startTime, endTime } = getStartEnd(day)
  const sMin = parseTime(startTime), eMin = parseTime(endTime)
  const lunchMin = day.lunchDuration ?? 0
  const workHrsStr = sMin !== null && eMin !== null
    ? `${(((eMin - sMin) - lunchMin) / 60).toFixed(1)} H${lunchMin ? ` (${lunchMin} min lunch)` : ''}`
    : (day.workHours || '—')
  const callTime = startTime || '—'
  const rts = day.rtsTime || startTime || '—'
  const locById = Object.fromEntries(locations.map(l => [l.id, l]))
  const daysCastIds = new Set(dayScenes.flatMap(s => s.castIds ?? []))
  const daysCast = allCast.filter(c => daysCastIds.has(c.castId)).sort((a, b) => a.castId - b.castId)
  const daySceneIds = new Set(dayScenes.map(s => s.id))
  const dayShots = shots.filter(sh => daySceneIds.has(sh.sceneId))
  const orderedRoleIds = crewRoles.map(r => r.id)
  const crewInOrder: ProductionCrewAssignmentDoc[] = [
    ...crewRoles.map(role => crew.find(c => c.roleId === role.id)).filter(Boolean) as ProductionCrewAssignmentDoc[],
    ...crew.filter(c => !orderedRoleIds.includes(c.roleId ?? '')),
  ]

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Column layout mirroring XLS (16 cols, proportional widths)
  const W = 277, ML = 10
  const xlsCols = [14,8,8,14,9,8,8,8,8,8,8,9,14,10,11,14]
  const totalChars = xlsCols.reduce((a,b)=>a+b,0)
  const cw = xlsCols.map(c => c/totalChars*W)
  const cx: number[] = []
  let ox = ML; cw.forEach(w => { cx.push(ox); ox += w })

  // width spanning from col `a` to col `b` inclusive
  function sw(a: number, b: number) { let w=0; for(let i=a;i<=b;i++) w+=cw[i]; return w }

  const RH = 6.0  // row height mm
  let y = 8

  type CO = { fill?: [number,number,number], tc?: [number,number,number], sz?: number, bold?: boolean, italic?: boolean, align?: 'L'|'C'|'R', border?: boolean, onlyBottom?: boolean, onlyTopBottom?: boolean }

  // Draw a filled+bordered cell
  function C(col: number, toCol: number, h: number, text: string, opts: CO = {}) {
    const { fill=[255,255,255], tc=[0,0,0], sz=8, bold=false, italic=false, align='C', border=true, onlyBottom=false, onlyTopBottom=false } = opts
    const xx = cx[col], ww = sw(col, toCol)
    doc.setFillColor(...fill); doc.rect(xx, y, ww, h, 'F')
    doc.setDrawColor(0,0,0); doc.setLineWidth(0.1)
    if (border && !onlyBottom && !onlyTopBottom) doc.rect(xx, y, ww, h, 'S')
    else if (onlyBottom) { doc.line(xx, y+h, xx+ww, y+h) }
    else if (onlyTopBottom) { doc.line(xx, y, xx+ww, y); doc.line(xx, y+h, xx+ww, y+h) }
    if (text) {
      doc.setFontSize(sz)
      doc.setFont('helvetica', bold&&italic?'bolditalic':bold?'bold':italic?'italic':'normal')
      doc.setTextColor(...tc)
      const ty = y + h*0.5 + sz*0.176  // vertical centering
      const tx = align==='C' ? xx+ww/2 : align==='R' ? xx+ww-1.5 : xx+1.5
      doc.text(text, tx, ty, { align: align==='C'?'center':align==='R'?'right':'left', maxWidth: ww-2.5 })
    }
  }
  // Draw at an absolute y (for multi-column rows drawn in parallel)
  function Ca(col: number, toCol: number, ay: number, h: number, text: string, opts: CO = {}) {
    const savedY = y; y = ay; C(col, toCol, h, text, opts); y = savedY
  }

  const GRAY: [number,number,number] = [192,192,192]
  const WHITE: [number,number,number] = [255,255,255]
  const BLACK: [number,number,number] = [0,0,0]

  // ── Row 0: Title bar ─────────────────────────────────────────────────────────
  C(0,  3,  RH, 'CALL SHEET', { bold:true, sz:11, align:'C' })
  C(4,  11, RH, '')
  C(12, 13, RH, `Shoot Date:  ${dateStr}`, { bold:true, sz:8, align:'L' })
  C(14, 15, RH, `Day ${dayNumber} of ${totalDays}`, { bold:true, align:'C' })
  y += RH

  // ── Row 1: separator ─────────────────────────────────────────────────────────
  C(0, 15, RH*0.5, '', { border:false, onlyBottom:true })
  y += RH*0.5

  // ── Rows 2-7: Info block (6 rows) ────────────────────────────────────────────
  const infoY = y
  const infoH = RH * 6
  const producers = crewInOrder.filter(c => (c.roleName??'').toLowerCase().includes('producer') && c.assignedName)
  const directorCrew = crewInOrder.find(c => (c.roleName??'').toLowerCase()==='director')
  const infoLeft = [
    { lbl: producers[0]?.roleName||'Producer',  val: producers[0]?.assignedName??'' },
    { lbl: producers[1]?.roleName||'Producer 2',val: producers[1]?.assignedName??'' },
    { lbl: 'Director',                           val: directorCrew?.assignedName??'' },
    { lbl: 'Nearest Hospital',                   val: '' },
    { lbl: '', val: '' },
    { lbl: '', val: '' },
  ]
  infoLeft.forEach(({lbl, val}) => {
    C(0, 0, RH, lbl, { bold:!!lbl, sz:7, align:'L' })
    C(1, 3, RH, val, { sz:7, align:'L' })
    y += RH
  })
  // Center: production title (drawn over the 6 rows)
  Ca(5,10, infoY, infoH, productionTitle, { fill:GRAY, bold:true, sz:16, align:'C' })
  // Col 11 vertical gap
  Ca(11,11, infoY, infoH, '', {})
  // Right: 6-row schedule table
  const sched: [string,string,boolean][] = [
    ['RTS', rts, false],
    ['EST. WRAP', endTime||'—', false],
    ['SUNRISE', 'SUNSET', false],
    [sunriseSunset?.sunrise??'—', sunriseSunset?.sunset??'—', false],
    ['WORKING DAY', 'WEATHER', false],
    [workHrsStr, [sunriseSunset?.weather, sunriseSunset?.temp].filter(Boolean).join('  ')||'—', false],
  ]
  sched.forEach(([l, rv], i) => {
    const isH = i%2===0
    Ca(12,13, infoY+i*RH, RH, l,  { bold:isH, sz:7, align:'L' })
    Ca(14,15, infoY+i*RH, RH, rv, { bold:isH, sz:7, align:'L' })
  })
  y = infoY + infoH

  // ── Row 8: double-line separator ────────────────────────────────────────────
  C(0, 15, RH*0.6, '', { border:false, onlyTopBottom:true })
  y += RH*0.6

  // ── Rows 9-12: CALL block (4 rows tall) ──────────────────────────────────────
  const callH = RH * 4
  C(0, 4, callH, 'Call times may vary. Contact 1st AD for details.', { sz:8, align:'C' })
  C(5, 5, callH, '', { border:false })  // gap
  // Draw CALL and time side by side in large text
  const callX = cx[6], callW = sw(6,7)
  const callLabelX = cx[8], callLabelW = sw(8,9)
  doc.setFillColor(...WHITE); doc.rect(callX, y, callW, callH, 'F'); doc.setDrawColor(...BLACK); doc.rect(callX, y, callW, callH, 'S')
  doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(...BLACK)
  doc.text('CALL', callX+callW/2, y+callH/2+3.2, {align:'center'})
  doc.setFillColor(...WHITE); doc.rect(callLabelX, y, callLabelW, callH, 'F'); doc.setDrawColor(...BLACK); doc.rect(callLabelX, y, callLabelW, callH, 'S')
  doc.setFontSize(18); doc.setFont('helvetica','bold')
  doc.text(callTime, callLabelX+callLabelW/2, y+callH/2+3.2, {align:'center'})
  C(10,10, callH, '', { border:false })  // gap
  C(11,15, callH, day.notes||'', { sz:9, align:'C' })
  y += callH

  // ── Row 13-14: separators ────────────────────────────────────────────────────
  C(0, 15, RH*0.5, '', { border:false, onlyBottom:true }); y += RH*0.5
  C(0, 15, RH*0.5, '', { border:false, onlyBottom:true }); y += RH*0.5

  // ── Scene table header ────────────────────────────────────────────────────────
  C(0,  0,  RH, 'SCENES',             { fill:GRAY, bold:true, sz:8 })
  C(1,  6,  RH, 'SET AND DESCRIPTION',{ fill:GRAY, bold:true, sz:8 })
  C(7,  8,  RH, 'CHARACTER #',        { fill:GRAY, bold:true, sz:8 })
  C(9,  9,  RH, 'D/N',               { fill:GRAY, bold:true, sz:8 })
  C(10, 10, RH, 'PAGES',              { fill:GRAY, bold:true, sz:8 })
  C(11, 15, RH, 'LOCATION / ADDRESS', { fill:GRAY, bold:true, sz:8 })
  y += RH

  // ── Scene rows (2 rows per scene) ────────────────────────────────────────────
  const movesMap = Object.fromEntries((day.locationMoves??[]).map(m=>[m.afterSceneId,m]))
  const sceneSlots = Math.max(dayScenes.length, 5)
  for (let i = 0; i < sceneSlots; i++) {
    const sc = dayScenes[i]
    const castNums = sc ? (sc.castIds??[]).join(', ') : ''
    const scLoc = sc?.locationId ? locById[sc.locationId] : null
    const addr = scLoc
      ? [scLoc.address, scLoc.zipCode, scLoc.state].filter(Boolean).join(', ') || (sc?.intExt??'')
      : (sc?.intExt??'')
    // Row A: scene number + location name + cast + D/N + pages + address
    C(0,  0,  RH, sc ? String(sc.sceneNumber)            : '', { bold:true, align:'C' })
    C(1,  6,  RH, sc ? (sc.location??'').toUpperCase()   : '', { bold:true, align:'C' })
    C(7,  8,  RH, castNums,                                     { align:'C' })
    C(9,  9,  RH, sc ? (sc.dayNight==='Night'?'N':'D')   : '', { align:'C' })
    C(10, 10, RH, sc ? (sc.pages?fmtPages(sc.pages):'')  : '', { align:'C' })
    C(11, 15, RH, addr,                                         { align:'C' })
    y += RH
    // Row B: description + INT/EXT
    C(1,  10, RH, sc ? (sc.description??'')              : '', { italic:true, sz:7, align:'L' })
    C(11, 15, RH, sc ? (sc.intExt??'')                   : '', { align:'C' })
    y += RH
    // Location move after this scene
    if (sc) {
      const move = movesMap[sc.id]
      if (move) {
        const lbl = `LOCATION MOVE  ${move.minutes} min${move.note ? `  ${move.note}` : ''}`
        C(0, 15, RH, lbl, { fill:[255,243,205], tc:[146,64,14], bold:true, sz:8, align:'L' })
        y += RH
      }
    }
  }

  // ── Total pages row ──────────────────────────────────────────────────────────
  const totalEighths = dayScenes.reduce((s,sc)=>s+(sc.pages??0),0)
  for (let i=0; i<9; i++) C(i,i, RH, '', { border:false, onlyBottom:true })
  C(9,  10, RH, 'TOTAL PAGES', { fill:GRAY, bold:true, sz:8 })
  C(11, 15, RH, totalEighths ? fmtPages(totalEighths) : '', { align:'C' })
  y += RH

  // ── Separator ────────────────────────────────────────────────────────────────
  C(0, 15, RH*0.5, '', { border:false, onlyBottom:true }); y += RH*0.5

  // ── Cast header ──────────────────────────────────────────────────────────────
  C(0,  0,  RH, '#',                   { fill:GRAY, bold:true, sz:8 })
  C(1,  2,  RH, 'CHARACTER',           { fill:GRAY, bold:true, sz:8 })
  C(3,  6,  RH, 'ACTOR / ACTRESS',     { fill:GRAY, bold:true, sz:8 })
  C(7,  7,  RH, 'SWHF',               { fill:GRAY, bold:true, sz:7 })
  C(8,  8,  RH, 'MU',                 { fill:GRAY, bold:true, sz:7 })
  C(9,  10, RH, 'SET',                { fill:GRAY, bold:true, sz:8 })
  C(11, 11, RH, 'MINOR?',             { fill:GRAY, bold:true, sz:7 })
  C(12, 15, RH, 'SPECIAL INSTRUCTIONS',{ fill:GRAY, bold:true, sz:8 })
  y += RH

  // ── Cast rows ────────────────────────────────────────────────────────────────
  const castSlots = Math.max(daysCast.length, 5)
  for (let i=0; i<castSlots; i++) {
    const cd = daysCast[i]
    C(0,  0,  RH, cd ? String(cd.castId)       : '', { align:'C' })
    C(1,  2,  RH, cd ? (cd.characterName??'') : '', { align:'L', sz:7 })
    C(3,  6,  RH, cd ? (cd.actorName??'')     : '', { align:'L', sz:7 })
    C(7,  7,  RH, '')
    C(8,  8,  RH, '')
    C(9,  10, RH, cd && rts!=='—' ? rts : '', { align:'C', sz:7 })
    C(11, 11, RH, '')
    C(12, 15, RH, '')
    y += RH
  }

  // ── Separator ────────────────────────────────────────────────────────────────
  C(0, 15, RH*0.5, '', { border:false, onlyTopBottom:true }); y += RH*0.5

  // ── Production notes ─────────────────────────────────────────────────────────
  C(0, 15, RH, 'PRODUCTION NOTES', { fill:GRAY, bold:true, sz:8 }); y += RH
  C(0, 7,  RH*4, ''); C(8, 15, RH*4, ''); y += RH*4

  // ── Separator ────────────────────────────────────────────────────────────────
  C(0, 15, RH*0.5, '', { border:false, onlyTopBottom:true }); y += RH*0.5

  // ── Crew table header ────────────────────────────────────────────────────────
  C(0,  3,  RH, 'POSITION', { fill:GRAY, bold:true, sz:8 })
  C(4,  7,  RH, 'NAME',     { fill:GRAY, bold:true, sz:8 })
  C(8,  8,  RH, '')
  C(9,  11, RH, 'POSITION', { fill:GRAY, bold:true, sz:8 })
  C(12, 15, RH, 'NAME',     { fill:GRAY, bold:true, sz:8 })
  y += RH

  // ── Crew rows (2-column) ──────────────────────────────────────────────────────
  const half = Math.max(Math.ceil(crewInOrder.length/2), 10)
  for (let i=0; i<half; i++) {
    const left  = crewInOrder[i]
    const right = crewInOrder[half+i]
    C(0,  3,  RH, left?.roleName??'',     { bold:!!left?.roleName, sz:7, align:'L' })
    C(4,  7,  RH, left?.assignedName??'', { sz:7, align:'L' })
    C(8,  8,  RH, '', { border:false })
    C(9,  11, RH, right?.roleName??'',     { bold:!!right?.roleName, sz:7, align:'L' })
    C(12, 15, RH, right?.assignedName??'', { sz:7, align:'L' })
    y += RH
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  C(0, 15, RH*0.4, '', { border:false, onlyBottom:true }); y += RH*0.4
  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(128,128,128)
  doc.text(`Generated by CineForge  |  ${productionTitle}  |  ${dateStr}`, ML+W/2, y+2, { align:'center' })

  const filename = `${productionTitle.replace(/[^a-z0-9]/gi,'_')}_callsheet_day${dayNumber}${day.date?`_${day.date}`:''}.pdf`
  doc.save(filename)
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
      if (!addrQuery) return
      try {
        // 1. Geocode
        const geoRes  = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addrQuery)}&format=json&limit=1`,
          { signal: controller.signal },
        )
        const geoData = await geoRes.json()
        if (!geoData.length) return
        const { lat, lon } = geoData[0]

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
              const hrRes  = await fetch(
                `${wxBase}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&start_date=${day.date}&end_date=${day.date}&timezone=Europe/Stockholm`,
                { signal: controller.signal },
              )
              const hrData = await hrRes.json()
              const times: string[] = hrData?.hourly?.time ?? []
              const temps: number[] = hrData?.hourly?.temperature_2m ?? []
              const filtered = times.reduce<number[]>((acc, t, i) => {
                const h = parseInt(t.split('T')[1] ?? '0')
                if (h * 60 >= startMin && h * 60 < endMin && temps[i] != null) acc.push(temps[i])
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
      result[day.id] = ((e - s) - lunchMin) / 60
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
                          onChange={e => { setLocal(day.id, 'date', e.target.value); saveDay(day.id, 'date', e.target.value) }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input type="time" className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-24 [color-scheme:dark]"
                          value={get(day.id, 'startTime', fallbackStart)}
                          onChange={e => { setLocal(day.id, 'startTime', e.target.value); saveDay(day.id, 'startTime', e.target.value) }} />
                        <span className="text-zinc-600 text-xs">–</span>
                        <input type="time" className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-24 [color-scheme:dark]"
                          value={get(day.id, 'endTime', fallbackEnd)}
                          onChange={e => { setLocal(day.id, 'endTime', e.target.value); saveDay(day.id, 'endTime', e.target.value) }} />
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-emerald-500 tracking-widest w-8 flex-shrink-0">RTS</span>
                        <input type="time" className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 w-24 [color-scheme:dark]"
                          value={get(day.id, 'rtsTime', day.rtsTime ?? '')}
                          onChange={e => { setLocal(day.id, 'rtsTime', e.target.value); saveDay(day.id, 'rtsTime', e.target.value) }} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-amber-400 tracking-widest w-12 flex-shrink-0">LUNCH</span>
                        <input type="time" className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500/30 w-24 [color-scheme:dark]"
                          placeholder="Start"
                          value={get(day.id, 'lunchStart', day.lunchStart ?? '')}
                          onChange={e => { setLocal(day.id, 'lunchStart', e.target.value); saveDay(day.id, 'lunchStart', e.target.value) }} />
                        <input type="number" min={0} step={5}
                          className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-amber-500/30 w-16 [color-scheme:dark]"
                          placeholder="min"
                          value={get(day.id, 'lunchDuration', day.lunchDuration != null ? String(day.lunchDuration) : '')}
                          onChange={e => { setLocal(day.id, 'lunchDuration', e.target.value); saveDay(day.id, 'lunchDuration', e.target.value ? Number(e.target.value) : '') }} />
                        <span className="text-[10px] text-zinc-500">min</span>
                      </div>
                      <input className="bg-zinc-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30 w-full sm:flex-1"
                        value={get(day.id, 'notes', day.notes)} placeholder="Day notes…"
                        onChange={e => setLocal(day.id, 'notes', e.target.value)}
                        onBlur={e => saveDay(day.id, 'notes', e.target.value)} />
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
