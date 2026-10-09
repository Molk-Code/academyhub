import type {
  ProductionShootingDayDoc, ProductionSceneDoc, ProductionCastDoc,
  ProductionCrewAssignmentDoc, ProductionLocationDoc, CrewRoleDoc, ProductionShotDoc,
} from '@/types'
import {
  parseTime, getStartEnd, shootDurationMinutes,
} from '@/components/production/CallSheetPreviewModal'

function fmtPages(eighths: number): string {
  if (!eighths) return ''
  const whole = Math.floor(eighths / 8)
  const rem   = eighths % 8
  if (whole === 0) return `${rem}/8`
  if (rem   === 0) return `${whole}`
  return `${whole} ${rem}/8`
}

// ── Call sheet export (XLSX) ────────────────────────────────────────────────
export async function exportCallSheet(
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
    ? `${((shootDurationMinutes(sMin, eMin) - lunchMin) / 60).toFixed(1)} H${lunchMin ? ` (${lunchMin} min lunch)` : ''}`
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
    const addr     = scLoc ? [scLoc.address, scLoc.zipCode, scLoc.state].filter(Boolean).join(', ') : ''
    const nameCell = scLoc?.name || sc.intExt
    const addrCell = scLoc ? addr : sc.intExt

    cell(r, 0, sc.sceneNumber,                  whiteB); merge(r, 0, r + 1, 0); fill(r, 0, r + 1, 0, whiteB)
    cell(r, 1, (sc.location ?? '').toUpperCase(), whiteB); merge(r, 1, r, 6); fill(r, 1, r, 6, whiteB)
    cell(r, 7, castNums, white); merge(r, 7, r, 8)
    cell(r, 9, sc.dayNight === 'Night' ? 'N' : 'D', white)
    cell(r, 10, sc.pages ? fmtPages(sc.pages) : '', white)
    cell(r, 11, nameCell, white); merge(r, 11, r, 15); fill(r, 11, r, 15, white)
    cell(r + 1, 1, sc.description ?? '', italicSt); merge(r + 1, 1, r + 1, 10); fill(r + 1, 1, r + 1, 10, italicSt)
    cell(r + 1, 11, addrCell, white); merge(r + 1, 11, r + 1, 15); fill(r + 1, 11, r + 1, 15, white)
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

// ── Call sheet export (PDF) ─────────────────────────────────────────────────
export async function exportCallSheetPDF(
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
    ? `${((shootDurationMinutes(sMin, eMin) - lunchMin) / 60).toFixed(1)} H${lunchMin ? ` (${lunchMin} min lunch)` : ''}`
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
    const addr = scLoc ? [scLoc.address, scLoc.zipCode, scLoc.state].filter(Boolean).join(', ') : ''
    const nameCell = sc ? (scLoc?.name || sc.intExt) : ''
    const addrCell = sc ? (scLoc ? addr : sc.intExt) : ''
    // Row A: scene number + location name + cast + D/N + pages + real place name
    C(0,  0,  RH, sc ? String(sc.sceneNumber)            : '', { bold:true, align:'C' })
    C(1,  6,  RH, sc ? (sc.location??'').toUpperCase()   : '', { bold:true, align:'C' })
    C(7,  8,  RH, castNums,                                     { align:'C' })
    C(9,  9,  RH, sc ? (sc.dayNight==='Night'?'N':'D')   : '', { align:'C' })
    C(10, 10, RH, sc ? (sc.pages?fmtPages(sc.pages):'')  : '', { align:'C' })
    C(11, 15, RH, nameCell,                                     { align:'C' })
    y += RH
    // Row B: description + address
    C(1,  10, RH, sc ? (sc.description??'')              : '', { italic:true, sz:7, align:'L' })
    C(11, 15, RH, addrCell,                                     { align:'C' })
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
