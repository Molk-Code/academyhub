import { useState, useEffect } from 'react'
import { collection, doc, setDoc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { format, formatDistanceToNow } from 'date-fns'

interface Shot {
  id: string
  sceneId: string
  shotNumber: number
  subject: string
  size: string
  angle: string
  movement: string
  notes: string
}

interface Scene {
  id: string
  sceneNumber: number
  location: string
  intExt: string
  dayNight: string
  description: string
}

interface ShootingDay {
  id: string
  dayNumber: number
  date: string
  rtsTime?: string
  sceneIds: string[]
}

interface Take {
  takeNumber: number
  rating: 'none' | 'ok' | 'ng' | 'best'
  notes: string
}

interface ShotLogEntry {
  shotId: string
  sceneNumber: number
  shotNumber: number
  subject: string
  shootingDayId: string
  takes: Take[]
  loggedBy: string
  loggedByName: string
  updatedAt: any
}

interface Props {
  productionId: string
  productionTitle: string
  scenes: Scene[]
  shots: Shot[]
  shootingDays: ShootingDay[]
  canEdit: boolean
}

export default function ShotLogTab({ productionId, productionTitle, scenes, shots, shootingDays, canEdit }: Props) {
  const { profile } = useAuth()
  const [selectedDayId, setSelectedDayId] = useState<string>('')
  const [logEntries,    setLogEntries]    = useState<Record<string, ShotLogEntry>>({})
  const [localEntries,  setLocalEntries]  = useState<Record<string, Partial<ShotLogEntry>>>({})

  // Select today's shooting day by default, or first upcoming day
  useEffect(() => {
    if (!shootingDays.length) return
    const today      = format(new Date(), 'yyyy-MM-dd')
    const todayDay   = shootingDays.find(d => d.date === today)
    const upcoming   = shootingDays.find(d => d.date >= today)
    setSelectedDayId((todayDay || upcoming || shootingDays[0]).id)
  }, [shootingDays])

  // Live listener on shotlog for selected day
  useEffect(() => {
    if (!selectedDayId || !productionId) return
    const q = query(
      collection(db, 'productions', productionId, 'shotlog'),
      where('shootingDayId', '==', selectedDayId),
    )
    return onSnapshot(q, snap => {
      const entries: Record<string, ShotLogEntry> = {}
      snap.docs.forEach(d => { entries[d.data().shotId] = d.data() as ShotLogEntry })
      setLogEntries(entries)
      // Sync local entries from remote on initial load (don't overwrite active edits)
      setLocalEntries(prev => {
        const next = { ...prev }
        snap.docs.forEach(d => {
          const data = d.data() as ShotLogEntry
          if (!next[data.shotId]) next[data.shotId] = data
        })
        return next
      })
    })
  }, [productionId, selectedDayId])

  const selectedDay  = shootingDays.find(d => d.id === selectedDayId)
  const daySceneIds  = selectedDay?.sceneIds ?? []
  const dayScenes    = scenes.filter(s => daySceneIds.includes(s.id))
  const dayShots     = shots.filter(s => daySceneIds.includes(s.sceneId))

  // Progress — derived from per-take ratings
  const totalShots = dayShots.length
  const doneShots  = dayShots.filter(s => getTakes(s.id).some(t => t.rating === 'ok' || t.rating === 'best')).length
  const ngShots    = dayShots.filter(s => { const t = getTakes(s.id); return t.length > 0 && t.every(t => t.rating === 'ng') }).length
  const bestShots  = dayShots.filter(s => getTakes(s.id).some(t => t.rating === 'best')).length
  const pct      = totalShots > 0 ? Math.round((doneShots / totalShots) * 100) : 0
  const barColor = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'

  async function saveEntry(shot: Shot, scene: Scene, updates: Partial<ShotLogEntry>) {
    if (!canEdit || !profile || !selectedDayId) return
    const entryId  = `${shot.id}_${selectedDayId}`
    const existing = logEntries[shot.id] ?? {
      shotId: shot.id,
      sceneNumber: scene.sceneNumber,
      shotNumber: shot.shotNumber,
      subject: shot.subject,
      shootingDayId: selectedDayId,
      takes: [],
      loggedBy: profile.uid,
      loggedByName: profile.displayName ?? 'Unknown',
    }
    await setDoc(
      doc(db, 'productions', productionId, 'shotlog', entryId),
      { ...existing, ...updates, loggedBy: profile.uid, loggedByName: profile.displayName ?? 'Unknown', updatedAt: new Date() },
      { merge: true },
    )
  }

  function getEntry(shotId: string): Partial<ShotLogEntry> {
    return localEntries[shotId] ?? logEntries[shotId] ?? {}
  }

  // Guard against old schema where takes was a number
  function getTakes(shotId: string): Take[] {
    const t = getEntry(shotId).takes
    return Array.isArray(t) ? t : []
  }

  function addTake(shot: Shot) {
    const scene = scenes.find(s => s.id === shot.sceneId)!
    const takes = [...getTakes(shot.id)]
    const newTake: Take = { takeNumber: takes.length + 1, rating: 'none', notes: '' }
    const updated = [...takes, newTake]
    setLocalEntries(prev => ({ ...prev, [shot.id]: { ...getEntry(shot.id), takes: updated } }))
    saveEntry(shot, scene, { takes: updated })
  }

  function removeTake(shot: Shot) {
    const scene = scenes.find(s => s.id === shot.sceneId)!
    const takes = [...getTakes(shot.id)]
    if (takes.length <= 1) return
    const updated = takes.slice(0, -1)
    setLocalEntries(prev => ({ ...prev, [shot.id]: { ...getEntry(shot.id), takes: updated } }))
    saveEntry(shot, scene, { takes: updated })
  }

  function updateTakeRating(shot: Shot, takeIndex: number, rating: Take['rating']) {
    const scene = scenes.find(s => s.id === shot.sceneId)!
    const takes = [...getTakes(shot.id)]
    takes[takeIndex] = { ...takes[takeIndex], rating }
    setLocalEntries(prev => ({ ...prev, [shot.id]: { ...getEntry(shot.id), takes } }))
    saveEntry(shot, scene, { takes })
  }

  function updateTakeNotes(shot: Shot, takeIndex: number, notes: string) {
    const takes = [...getTakes(shot.id)]
    takes[takeIndex] = { ...takes[takeIndex], notes }
    setLocalEntries(prev => ({ ...prev, [shot.id]: { ...getEntry(shot.id), takes } }))
  }

  function saveTakeNotes(shot: Shot) {
    const scene = scenes.find(s => s.id === shot.sceneId)!
    const takes = getTakes(shot.id)
    saveEntry(shot, scene, { takes })
  }

  const [showWrap, setShowWrap] = useState(false)

  async function downloadWrapReportPDF() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const dateStr = selectedDay?.date
      ? new Date(selectedDay.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `Day ${selectedDay?.dayNumber}`

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const PW = 210, M = 14, CW = PW - M * 2

    // Header band
    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, PW, 22, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(13).setFont('helvetica', 'bold')
    doc.text('CineForge', M, 14)
    doc.setFontSize(8).setFont('helvetica', 'normal')
    doc.setTextColor(148, 163, 184)
    doc.text('Wrap Report', M + 30, 14)

    // Accent stripe
    doc.setFillColor(249, 115, 22)
    doc.rect(0, 22, PW, 1.2, 'F')

    let y = 32

    // Title
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(16).setFont('helvetica', 'bold')
    doc.text(`${productionTitle}`, M, y)
    y += 7
    doc.setFontSize(9).setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    doc.text(`Day ${selectedDay?.dayNumber}  ·  ${dateStr}`, M, y)
    y += 10

    // Stats row
    const stats = [
      { val: String(doneShots),                        lbl: 'Done',     r: 16, g: 185, b: 129 },
      { val: String(bestShots),                        lbl: 'Best take', r: 245, g: 158, b: 11 },
      { val: String(ngShots),                          lbl: 'All NG',   r: 239, g: 68,  b: 68 },
      { val: String(totalShots - doneShots - ngShots), lbl: 'Pending',  r: 107, g: 114, b: 128 },
    ]
    const boxW = CW / 4 - 2
    stats.forEach((s, i) => {
      const bx = M + i * (boxW + 2.5)
      doc.setFillColor(243, 244, 246)
      doc.roundedRect(bx, y, boxW, 18, 2, 2, 'F')
      doc.setFontSize(18).setFont('helvetica', 'bold')
      doc.setTextColor(s.r, s.g, s.b)
      doc.text(s.val, bx + boxW / 2, y + 11, { align: 'center' })
      doc.setFontSize(7).setFont('helvetica', 'normal')
      doc.setTextColor(107, 114, 128)
      doc.text(s.lbl, bx + boxW / 2, y + 16, { align: 'center' })
    })
    y += 24

    // Takes table
    const tableRows: any[] = []
    dayShots.forEach(shot => {
      const scene = scenes.find(sc => sc.id === shot.sceneId)
      const takes = getTakes(shot.id)
      if (takes.length === 0) {
        tableRows.push([`Sc${scene?.sceneNumber ?? '?'}`, shot.shotNumber, shot.subject, '—', '—', ''])
        return
      }
      takes.forEach((t, i) => {
        const rating = t.rating === 'best' ? 'BEST' : t.rating === 'ok' ? 'OK' : t.rating === 'ng' ? 'NG' : '-'
        tableRows.push([
          i === 0 ? `Sc${scene?.sceneNumber ?? '?'}` : '',
          i === 0 ? shot.shotNumber : '',
          i === 0 ? shot.subject : '',
          `T${t.takeNumber}`,
          rating,
          t.notes ?? '',
        ])
      })
    })

    autoTable(doc, {
      startY: y,
      head: [['Scene', 'Shot', 'Subject', 'Take', 'Rating', 'Notes']],
      body: tableRows,
      styles: { fontSize: 8, cellPadding: 2.5, font: 'helvetica' },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 14 },
        1: { cellWidth: 12 },
        2: { cellWidth: 46 },
        3: { cellWidth: 14 },
        4: { cellWidth: 20 },
        5: { cellWidth: CW - 106 },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const v = String(data.cell.raw ?? '')
          if (v === 'BEST')      data.cell.styles.textColor = [245, 158, 11]
          else if (v === 'OK')   data.cell.styles.textColor = [16, 185, 129]
          else if (v === 'NG')   data.cell.styles.textColor = [239, 68, 68]
        }
      },
      margin: { left: M, right: M },
    })

    // Reshoot list
    const ngList = dayShots.filter(s => {
      const t = getTakes(s.id)
      return t.length > 0 && t.every(tk => tk.rating === 'ng')
    })
    if (ngList.length > 0) {
      const finalY = (doc as any).lastAutoTable.finalY + 8
      doc.setFillColor(254, 242, 242)
      doc.setDrawColor(252, 165, 165)
      const reshootRows = ngList.map(s => {
        const sc = scenes.find(sc => sc.id === s.sceneId)
        return [`Sc${sc?.sceneNumber}`, s.shotNumber, s.subject]
      })
      autoTable(doc, {
        startY: finalY,
        head: [['Reshoot Required — Scene', 'Shot', 'Subject']],
        body: reshootRows,
        styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [239, 68, 68], textColor: 255, fontStyle: 'bold' },
        margin: { left: M, right: M },
      })
    }

    // Footer
    const pageCount = (doc as any).internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFillColor(15, 23, 42)
      doc.rect(0, 287, PW, 10, 'F')
      doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(148, 163, 184)
      doc.text(`Generated by CineForge  ·  ${new Date().toLocaleDateString()}  ·  Page ${i} of ${pageCount}`, PW / 2, 293, { align: 'center' })
    }

    doc.save(`${productionTitle.replace(/[^a-z0-9]/gi, '_')}_WrapReport_Day${selectedDay?.dayNumber}.pdf`)
  }

  function shotTypeAbbr(size: string): string {
    const s = size.toUpperCase().trim()
    if (!s) return ''
    if (s.includes('EXTREME CLOSE') || s === 'ECU') return 'ECU'
    if (s.includes('EXTREME WIDE')  || s === 'EWS') return 'EWS'
    if (s.includes('CLOSE')  || s === 'CU')  return 'CU'
    if (s.includes('MEDIUM CLOSE')  || s === 'MCU') return 'MCU'
    if (s.includes('MEDIUM') || s === 'MS' || s.includes('MID'))  return 'MS'
    if (s.includes('WIDE')   || s === 'WS' || s.includes('LONG')) return 'WS'
    if (s.includes('INSERT') || s === 'INS') return 'INS'
    if (s.includes('OVER THE SHOULDER') || s === 'OTS') return 'OTS'
    if (s.includes('TWO SHOT') || s === '2S') return '2S'
    if (s.includes('AERIAL') || s.includes('DRONE')) return 'AERIAL'
    // fall back: first word, max 4 chars
    return s.split(/\s+/)[0].slice(0, 4)
  }

  function exportForDaVinciResolve() {
    // DaVinci Resolve recognized CSV columns (File → Import Metadata and Conform → CSV)
    const headers = [
      'File Name', 'Clip Name', 'Scene', 'Shot', 'Take',
      'Slate', 'Shot Type', 'Angle',
      'Interior/Exterior', 'Day / Night',
      'Good Take', 'Description', 'Comments', 'Keywords', 'Status',
    ]
    const rows: string[][] = [headers]

    dayShots.forEach(shot => {
      const scene = scenes.find(s => s.id === shot.sceneId)
      if (!scene) return
      const takes = getTakes(shot.id)
      if (takes.length === 0) return

      const sceneNum = String(scene.sceneNumber).padStart(2, '0')
      const shotNum  = String(shot.shotNumber).padStart(2, '0')
      const abbr     = shotTypeAbbr(shot.size)
      const keywords = [shot.size, scene.intExt, scene.dayNight, scene.location].filter(Boolean).join(' ')

      takes.forEach(take => {
        const takeNum  = String(take.takeNumber).padStart(2, '0')
        // Filename encodes scene + shot + shot-type abbreviation + take
        const fileName = abbr
          ? `SC${sceneNum}_SH${shotNum}_${abbr}_T${takeNum}.mp4`
          : `SC${sceneNum}_SH${shotNum}_T${takeNum}.mp4`
        const slate    = `SC${sceneNum}_SH${shotNum}_T${takeNum}`
        const isGood   = take.rating === 'ok' || take.rating === 'best'
        const comments = [
          take.rating === 'best' ? 'BEST TAKE' : '',
          take.rating === 'ng'   ? 'NG'        : '',
          take.notes,
        ].filter(Boolean).join(' | ')

        rows.push([
          fileName,
          fileName,                        // Clip Name same as File Name
          String(scene.sceneNumber),
          String(shot.shotNumber),
          String(take.takeNumber),
          slate,                           // Slate: SC01_SH02_T03
          shot.size,                       // Shot Type: full label (WS, CU, etc.)
          shot.angle,                      // Angle
          scene.intExt,                    // Interior/Exterior
          scene.dayNight,                  // Day / Night
          isGood ? 'true' : 'false',
          shot.subject,                    // Description
          comments,
          keywords,
          take.rating === 'best' ? 'Best' : take.rating === 'ok' ? 'OK' : take.rating === 'ng' ? 'NG' : 'Pending',
        ])
      })
    })

    const csv = rows.map(row =>
      row.map(cell => {
        const str = String(cell ?? '')
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"` : str
      }).join(',')
    ).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }) // BOM for Excel compat
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${productionTitle.replace(/[^a-z0-9]/gi, '_')}_Day${selectedDay?.dayNumber}_DaVinci.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!shootingDays.length) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <p className="text-4xl mb-3">📅</p>
        <p className="font-medium text-zinc-400">No shooting days yet</p>
        <p className="text-sm mt-1">Add a shooting day in the Schedule tab first</p>
      </div>
    )
  }

  return (
    <div className="pb-20">
      {/* Day selector */}
      <div className="flex gap-2 flex-wrap mb-4">
        {shootingDays.map(day => (
          <button key={day.id} onClick={() => setSelectedDayId(day.id)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              selectedDayId === day.id ? 'bg-orange-500 text-white' : 'bg-white/10 text-zinc-400 hover:bg-white/15'
            }`}>
            Day {day.dayNumber} · {day.date ? format(new Date(day.date + 'T12:00:00'), 'EEE d MMM') : '—'}
          </button>
        ))}
      </div>

      {/* Progress bar */}
      {totalShots > 0 && (
        <div className="bg-white/5 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white">{doneShots} / {totalShots} shots completed</span>
            <span className="text-sm font-bold text-white">{pct}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-4 text-xs text-zinc-400">
            <span>✓ {doneShots} done</span>
            <span>★ {bestShots} best take</span>
            <span>✕ {ngShots} all-NG</span>
            <span>— {totalShots - doneShots - ngShots} pending</span>
          </div>
        </div>
      )}

      {daySceneIds.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-3xl mb-2">🎬</p>
          <p className="font-medium text-zinc-400">No scenes scheduled for Day {selectedDay?.dayNumber}</p>
          <p className="text-sm mt-1">Drag scenes into this day from the Schedule tab</p>
        </div>
      )}

      {daySceneIds.length > 0 && dayShots.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-3xl mb-2">📋</p>
          <p className="font-medium text-zinc-400">No shots planned for these scenes</p>
          <p className="text-sm mt-1">Add shots in the Shot List tab first</p>
        </div>
      )}

      {/* Scenes and shots */}
      {dayScenes.map(scene => {
        const sceneShots = dayShots.filter(s => s.sceneId === scene.id)
        if (!sceneShots.length) return null
        return (
          <div key={scene.id} className="mb-6">
            <div className="flex items-center gap-2 py-2 border-b border-white/10 mb-3">
              <span className="text-xs font-bold bg-white/10 px-2 py-1 rounded">Scene {scene.sceneNumber}</span>
              <span className="text-sm font-semibold text-zinc-200">{scene.location}</span>
              <span className="text-xs text-zinc-400">{scene.intExt} · {scene.dayNight}</span>
              <span className="text-xs text-zinc-500 ml-auto truncate max-w-[200px]">{scene.description}</span>
            </div>
            {sceneShots.map(shot => {
              const takes = getTakes(shot.id)
              const ratingStyles = {
                ng:   { active: 'bg-red-700 text-white',     inactive: 'bg-white/5 text-zinc-600 hover:bg-red-900/30 hover:text-red-400',      label: '✕ NG'   },
                ok:   { active: 'bg-emerald-700 text-white', inactive: 'bg-white/5 text-zinc-600 hover:bg-emerald-900/30 hover:text-emerald-400', label: '✓ OK'   },
                best: { active: 'bg-amber-500 text-black',   inactive: 'bg-white/5 text-zinc-600 hover:bg-amber-900/30 hover:text-amber-400',   label: '★ Best' },
              }
              return (
                <div key={shot.id} className="bg-white/5 rounded-xl p-3 mb-2 border border-white/[0.08]">
                  {/* Shot header */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-xs text-zinc-400 font-mono">Shot {shot.shotNumber}</span>
                      <p className="font-semibold text-sm mt-0.5 text-zinc-100">{shot.subject}</p>
                      <p className="text-xs text-zinc-500">{shot.size} · {shot.angle} · {shot.movement}</p>
                    </div>
                    {canEdit && (
                      <button onClick={() => addTake(shot)}
                        className="bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                        + Take
                      </button>
                    )}
                  </div>

                  {/* Takes table */}
                  {takes.length === 0 ? (
                    <p className="text-xs text-zinc-600 italic">No takes yet — press + Take to start</p>
                  ) : (
                    <div className="space-y-1.5">
                      {takes.map((take, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-xs font-mono text-zinc-400 w-12 flex-shrink-0">T{take.takeNumber}</span>
                          {canEdit ? (
                            <div className="flex gap-1 flex-shrink-0">
                              {(['ng', 'ok', 'best'] as const).map(r => (
                                <button key={r}
                                  onClick={() => updateTakeRating(shot, idx, take.rating === r ? 'none' : r)}
                                  className={`px-2 py-1 rounded-lg text-xs font-bold transition-all ${take.rating === r ? ratingStyles[r].active : ratingStyles[r].inactive}`}>
                                  {ratingStyles[r].label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                              take.rating === 'best' ? 'bg-amber-900/40 text-amber-400' :
                              take.rating === 'ok'   ? 'bg-emerald-900/40 text-emerald-400' :
                              take.rating === 'ng'   ? 'bg-red-900/40 text-red-400' : 'text-zinc-600'
                            }`}>
                              {take.rating === 'best' ? '★ Best' : take.rating === 'ok' ? '✓ OK' : take.rating === 'ng' ? '✕ NG' : '—'}
                            </span>
                          )}
                          {canEdit ? (
                            <input
                              value={take.notes ?? ''}
                              onChange={e => updateTakeNotes(shot, idx, e.target.value)}
                              onBlur={() => saveTakeNotes(shot)}
                              placeholder="Note…"
                              className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 text-xs text-zinc-300 placeholder-zinc-700 border border-white/5 focus:border-orange-500/30 outline-none"
                            />
                          ) : take.notes ? (
                            <span className="text-xs text-zinc-500 flex-1 truncate">{take.notes}</span>
                          ) : null}
                          {canEdit && idx === takes.length - 1 && takes.length > 1 && (
                            <button onClick={() => removeTake(shot)} className="text-zinc-700 hover:text-red-400 text-xs ml-1 flex-shrink-0">✕</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Shot summary */}
                  {takes.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-3 text-xs text-zinc-500">
                      <span>{takes.length} take{takes.length !== 1 ? 's' : ''}</span>
                      {takes.some(t => t.rating === 'best') && (
                        <span className="text-amber-400">★ Best: T{takes.find(t => t.rating === 'best')?.takeNumber}</span>
                      )}
                      {takes.filter(t => t.rating === 'ng').length > 0 && (
                        <span className="text-red-400">✕ {takes.filter(t => t.rating === 'ng').length} NG</span>
                      )}
                      {takes.filter(t => t.rating === 'ok').length > 0 && (
                        <span className="text-emerald-400">✓ {takes.filter(t => t.rating === 'ok').length} OK</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      {/* Action buttons */}
      {totalShots > 0 && canEdit && (
        <div className="mt-4">
          <button onClick={() => setShowWrap(true)}
            className="w-full border border-white/10 hover:bg-white/5 text-zinc-400 font-medium py-3 rounded-xl text-sm transition-colors">
            📊 Generate Wrap Report
          </button>
        </div>
      )}

      {/* Wrap Report Modal */}
      {showWrap && selectedDay && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowWrap(false)}>
          <div className="bg-zinc-900 rounded-2xl border border-white/10 max-w-md w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-zinc-100 mb-1">Wrap Report</h2>
            <p className="text-sm text-zinc-400 mb-4">Day {selectedDay.dayNumber} · {selectedDay.date}</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-900/30 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-emerald-400">{doneShots}</p>
                <p className="text-xs text-zinc-400">Shots done</p>
              </div>
              <div className="bg-red-900/30 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-red-400">{ngShots}</p>
                <p className="text-xs text-zinc-400">All-NG shots</p>
              </div>
              <div className="bg-amber-900/30 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-amber-400">{bestShots}</p>
                <p className="text-xs text-zinc-400">Best take marked</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-zinc-300">{totalShots - doneShots - ngShots}</p>
                <p className="text-xs text-zinc-400">Not reached</p>
              </div>
            </div>
            {/* All-NG shots */}
            {ngShots > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-zinc-400 uppercase mb-2">All-NG Shots — Need Reshoot</p>
                {dayShots.filter(s => {
                  const t = getTakes(s.id)
                  return t.length > 0 && t.every(tk => tk.rating === 'ng')
                }).map(s => (
                  <div key={s.id} className="text-xs text-red-300 py-1 border-b border-white/5">
                    Scene {scenes.find(sc => sc.id === s.sceneId)?.sceneNumber} / Shot {s.shotNumber}: {s.subject}
                  </div>
                ))}
              </div>
            )}
            {/* Per-take notes */}
            {dayShots.some(s => (getTakes(s.id)).some(t => t.notes)) && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-zinc-400 uppercase mb-2">Take Notes</p>
                {dayShots.map(s => {
                  const takesWithNotes = (getTakes(s.id)).filter(t => t.notes)
                  if (!takesWithNotes.length) return null
                  const sc = scenes.find(sc => sc.id === s.sceneId)
                  return takesWithNotes.map((t, i) => (
                    <div key={`${s.id}_${i}`} className="text-xs text-zinc-300 py-1 border-b border-white/5">
                      <span className="text-zinc-500">Sc{sc?.sceneNumber}/Sh{s.shotNumber}/T{t.takeNumber}:</span> {t.notes}
                    </div>
                  ))
                })}
              </div>
            )}
            <div className="bg-white/5 rounded-xl p-3 mb-3 space-y-1.5">
              <p className="text-xs text-zinc-400 font-semibold">📋 How to sync CSV with DaVinci</p>
              <p className="text-xs text-zinc-300 font-medium">1. Import your footage into DaVinci as normal</p>
              <p className="text-xs text-zinc-500">Sort the Media Pool by <span className="text-zinc-300">Date Created</span> so clips appear in shooting order.</p>
              <p className="text-xs text-zinc-300 font-medium">2. Rename each clip to match the CSV</p>
              <p className="text-xs text-zinc-500">Right-click a clip → <span className="text-zinc-300">Clip Attributes → Clip Name</span> → paste the filename from the CSV <span className="text-zinc-300">File Name</span> column (e.g. <code className="bg-white/10 px-1 rounded text-zinc-300">SC01_SH02_CU_T02.mp4</code>). This only renames the display name — the file on disk is unchanged.</p>
              <p className="text-xs text-zinc-300 font-medium">3. Import the CSV</p>
              <p className="text-xs text-zinc-500"><code className="bg-white/10 px-1 rounded text-zinc-300">File → Import Metadata and Conform → CSV</code> — DaVinci matches each row to the clip by name and writes Slate, Shot Type, Scene, Take and Good Take onto the clip.</p>
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setShowWrap(false)}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
                Close
              </button>
              <button onClick={downloadWrapReportPDF}
                className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                📄 Download PDF
              </button>
              <button onClick={() => { exportForDaVinciResolve(); setShowWrap(false) }}
                className="flex-1 py-2.5 rounded-xl border border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-400 text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
                🎬 DaVinci CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
