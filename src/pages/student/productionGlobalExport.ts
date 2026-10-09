import type {
  ProductionDoc, ProductionSceneDoc, ProductionCastDoc, ProductionShotDoc,
  ProductionShootingDayDoc, ProductionCrewAssignmentDoc, ProductionLocationDoc,
  ProductionCostumeDoc, ProductionMakeupDoc, ProductionPropsDoc,
} from '@/types'

// ── XLS export (client-side, multi-sheet with styling) ───────────────────────
export async function exportXLS(
  production: ProductionDoc,
  scenes: ProductionSceneDoc[],
  cast: ProductionCastDoc[],
  shots: ProductionShotDoc[],
  shootingDays: ProductionShootingDayDoc[],
  crew: ProductionCrewAssignmentDoc[],
  locations: ProductionLocationDoc[],
  costumes: ProductionCostumeDoc[],
  makeupItems: ProductionMakeupDoc[],
  propsItems: ProductionPropsDoc[],
) {
  const XLSX = await import('xlsx-js-style')

  const sceneById = Object.fromEntries(scenes.map(s => [s.id, s]))
  const castById  = Object.fromEntries(cast.map(c => [String(c.castId), c]))
  const castNames = (ids: number[]) =>
    (ids ?? []).map(id => castById[String(id)]?.characterName ?? `ID${id}`).join(', ')

  const costumeById = Object.fromEntries(costumes.map(c => [c.id, c]))
  const makeupById  = Object.fromEntries(makeupItems.map(c => [c.id, c]))
  const propsById   = Object.fromEntries(propsItems.map(c => [c.id, c]))
  const itemNames = (ids: string[] | undefined, byId: Record<string, ProductionCostumeDoc>) =>
    (ids ?? []).map(id => byId[id]?.characterName).filter(Boolean).join(', ')
  const scenesForItem = (itemId: string, field: 'costumeIds' | 'makeupIds' | 'propsIds') =>
    scenes
      .filter(s => ((s[field] as string[] | undefined) ?? []).includes(itemId))
      .map(s => s.sceneNumber)
      .sort((a, b) => a - b)
      .join(', ')

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
    ['Scene', 'D/N', 'INT/EXT', 'Location', 'Description', 'Character/s', 'Costumes', 'Make-up', 'Props', 'Notes'],
    sortedScenes.map(s => [s.sceneNumber, s.dayNight, s.intExt, s.location, s.description,
      castNames(s.castIds), itemNames(s.costumeIds, costumeById), itemNames(s.makeupIds, makeupById), itemNames(s.propsIds, propsById), s.notes]),
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
    l.scriptName || l.name,
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
    locRows.push([v.scenes.join(', '), name, '', v.intExt, '', ''])
  })
  addSheet('Locations', `Locations — ${production.title}`,
    ['Scene/s', 'Script Name', 'Real Name', 'INT/EXT', 'Address', 'Notes'],
    locRows,
    [14, 26, 26, 10, 46, 24])

  // ── Actors ───────────────────────────────────────────────────────────────────
  addSheet('Actors', `Actors — ${production.title}`,
    ['ID', 'Character', 'Actor', 'Scenes'],
    sortedCast.map(c => [c.castId, c.characterName, c.actorName, (c.scenes ?? []).join(', ')]),
    [7, 28, 28, 28])

  // ── Costume ───────────────────────────────────────────────────────────────────
  addSheet('Costume', `Costume — ${production.title}`,
    ['Character', 'Description', 'Scenes', 'Responsible', 'Notes'],
    [...costumes].sort((a, b) => a.order - b.order)
      .map(it => [it.characterName, it.description, scenesForItem(it.id, 'costumeIds'), it.responsible, it.notes]),
    [24, 40, 16, 24, 36])

  // ── Make-Up ───────────────────────────────────────────────────────────────────
  addSheet('Make-Up', `Make-Up — ${production.title}`,
    ['Character', 'Description', 'Scenes', 'Responsible', 'Notes'],
    [...makeupItems].sort((a, b) => a.order - b.order)
      .map(it => [it.characterName, it.description, scenesForItem(it.id, 'makeupIds'), it.responsible, it.notes]),
    [24, 40, 16, 24, 36])

  // ── Props ─────────────────────────────────────────────────────────────────────
  addSheet('Props', `Props — ${production.title}`,
    ['Item', 'Description', 'Scenes', 'Responsible', 'Notes'],
    [...propsItems].sort((a, b) => a.order - b.order)
      .map(it => [it.characterName, it.description, scenesForItem(it.id, 'propsIds'), it.responsible, it.notes]),
    [24, 40, 16, 24, 36])

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
