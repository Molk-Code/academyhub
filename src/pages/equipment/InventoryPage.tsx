import { useState, useEffect, useRef, useMemo } from 'react'
import { StatsContent } from './InventoryStats'
import {
  collection, collectionGroup, addDoc, updateDoc, deleteDoc, doc, getDocs,
  serverTimestamp, query, where, onSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection } from '@/hooks/useFirestore'
import type { EquipmentDoc, InventoryProjectDoc, InventoryItemDoc, UserDoc } from '@/types'
import {
  Package, Calendar, Users, Clock, AlertTriangle, Check, Trash2, Plus,
  ChevronDown, ChevronRight, ArrowLeft, Edit2, CheckCircle2, ArchiveRestore,
  Layers, Search, X, ZapOff, Scan, Smartphone, QrCode,
} from 'lucide-react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import { QRCodeSVG } from 'qrcode.react'
import { optimizeImageUrl } from '@/lib/cloudinary'
import './molkom.css'

function EquipmentImg({ url, name, fallback }: { url: string | undefined | null; name: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <>{fallback}</>
  return <img src={optimizeImageUrl(url)} alt={name} onError={() => setFailed(true)} />
}

type InvTab = 'dashboard' | 'all-projects' | 'equipment-status' | 'borrower-stats' | 'statistics'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function isOverdue(returnDate: string): boolean {
  if (!returnDate) return false
  return returnDate < today()
}

function formatDate(d: string) {
  if (!d) return '—'
  const dt = new Date(d + 'T12:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function overdueDays(returnDate: string): number {
  if (!returnDate) return 0
  const diff = Math.round((new Date(today()).getTime() - new Date(returnDate + 'T00:00:00').getTime()) / 86400000)
  return diff > 0 ? diff : 0
}

function beep(freq: number) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch {}
}

// ── Equipment Picker Overlay ───────────────────────────────────────────────────

function EquipmentPicker({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (name: string) => void
}) {
  const { data: equipment } = useCollection<EquipmentDoc>('equipment')
  const active = equipment.filter(e => e.isActive).sort((a, b) => a.name.localeCompare(b.name))
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('ALL')

  const cats = ['ALL', 'CAMERA', 'GRIP', 'LIGHTS', 'SOUND', 'LOCATION', 'BOOKS', 'OTHER']

  const filtered = active.filter(e => {
    if (cat !== 'ALL' && e.category !== cat) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="equip-picker-overlay">
      <div className="equip-picker-modal">
        <div className="equip-picker-header">
          <h3>Add Equipment</h3>
          <button className="equip-picker-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="equip-picker-search">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search equipment..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="equip-picker-categories">
          {cats.map(c => (
            <button
              key={c}
              className={`equip-picker-cat-btn${cat === c ? ' active' : ''}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="equip-picker-grid">
          {filtered.map(e => (
            <button key={e.id} className="equip-picker-card" onClick={() => onPick(e.name)}>
              <div className="equip-picker-img">
                <EquipmentImg
                  url={e.imageUrl}
                  name={e.name}
                  fallback={<div className="equip-picker-placeholder">{e.name}</div>}
                />
                <span className="equip-picker-cat-tag">{e.category}</span>
                {e.priceInclVat > 0 && (
                  <span className="equip-picker-price-tag">{e.priceInclVat} kr/day</span>
                )}
              </div>
              <div className="equip-picker-info">
                <div className="equip-picker-name">{e.name}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  items = [],
  onClick,
}: {
  project: InventoryProjectDoc
  items?: InventoryItemDoc[]
  onClick: () => void
}) {
  const overdue = isOverdue(project.returnDate) && ['active', 'checked-out'].includes(project.status)
  const od = overdueDays(project.returnDate)

  const checkedOut = items.filter(i => i.status === 'checked-out').length
  const returned   = items.filter(i => i.status === 'returned').length
  const missing    = items.filter(i => i.status === 'missing').length
  const damaged    = items.filter(i => i.status === 'damaged').length
  const total      = items.length

  const statusClass =
    project.status === 'active' ? 'status-active' :
    project.status === 'checked-out' ? 'status-checkout' :
    project.status === 'returned' ? 'status-returned' : 'status-archived'

  return (
    <div className="project-card" onClick={onClick}>
      <div className="project-card-header">
        <Package size={16} />
        <span style={{ fontSize: '.75rem', fontWeight: 600, color: '#a0a0b5' }}>Project</span>
        <div className="project-card-badges">
          <span className={`project-status-badge ${statusClass}`}>{project.status}</span>
          {missing > 0 && <span className="project-status-badge" style={{ background: 'rgba(255,71,87,.15)', color: '#ff4757', borderColor: 'rgba(255,71,87,.3)' }}>⚠ {missing} missing</span>}
          {damaged > 0 && <span className="project-status-badge" style={{ background: 'rgba(255,165,2,.15)', color: '#ffa502', borderColor: 'rgba(255,165,2,.3)' }}>⚠ {damaged} damaged</span>}
        </div>
      </div>
      <div className="project-card-name">{project.name}</div>
      <div className="project-card-meta">
        {project.borrowers?.length > 0 && (
          <div className="project-card-meta-item">
            <Users size={13} />
            <span>{project.borrowers.slice(0, 3).join(', ')}{project.borrowers.length > 3 ? ` +${project.borrowers.length - 3}` : ''}</span>
          </div>
        )}
        <div className="project-card-meta-item">
          <Calendar size={13} />
          <span>{formatDate(project.checkoutDate)} – {formatDate(project.returnDate)}</span>
        </div>
        {project.equipmentManagerName && (
          <div className="project-card-meta-item">
            <Clock size={13} />
            <span>Manager: {project.equipmentManagerName}</span>
          </div>
        )}
      </div>
      {/* Item summary bar */}
      {total > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: '.5rem', flexWrap: 'wrap' }}>
          {checkedOut > 0 && <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#f97316' }}>📦 {checkedOut} out</span>}
          {returned   > 0 && <span style={{ fontSize: '.7rem', fontWeight: 600, color: '#4cd964' }}>✓ {returned} returned</span>}
          {missing    > 0 && <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#ff4757' }}>? {missing} missing</span>}
          {damaged    > 0 && <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#ffa502' }}>⚠ {damaged} damaged</span>}
        </div>
      )}
      <div className="project-card-footer">
        {overdue
          ? <span style={{ color: '#ff4757', fontWeight: 700, fontSize: '.75rem' }}>{od} day{od !== 1 ? 's' : ''} overdue</span>
          : <span style={{ fontSize: '.7rem', color: '#4a4a60' }}>{total} item{total !== 1 ? 's' : ''}</span>
        }
      </div>
    </div>
  )
}

// ── Project Detail ─────────────────────────────────────────────────────────────

function ProjectDetail({
  project,
  onBack,
  onUpdate,
}: {
  project: InventoryProjectDoc
  onBack: () => void
  onUpdate: (data: Partial<InventoryProjectDoc>) => Promise<void>
}) {
  const { data: items } = useCollection<InventoryItemDoc>(`inventory_projects/${project.id}/items`)
  const { data: equipmentAll } = useCollection<EquipmentDoc>('equipment')

  const [scanMode, setScanMode] = useState<'checkout' | 'checkin'>('checkout')
  const [scanActive, setScanActive] = useState(false)
  const [scanEntries, setScanEntries] = useState<{ name: string; time: string }[]>([])
  const [manualInput, setManualInput] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [inlineDamage, setInlineDamage] = useState<Record<string, string>>({})
  const [damageEdit, setDamageEdit] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const [editReturn, setEditReturn] = useState(project.returnDate)

  // Remote scanner session
  const [remoteSessionId, setRemoteSessionId] = useState<string | null>(null)
  const [remoteScanCount, setRemoteScanCount] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const lastScanRef = useRef<string>('')
  const lastScanTimeRef = useRef<number>(0)

  const activeItems = useMemo(() => ['active', 'checked-out'].includes(project.status), [project.status])
  const overdue = isOverdue(project.returnDate) && activeItems

  const returnedCount = items.filter(i => i.status === 'returned').length
  const checkedOutCount = items.filter(i => i.status === 'checked-out').length
  const missingCount = items.filter(i => i.status === 'missing').length

  // Listen to remote check-in signals from mobile
  useEffect(() => {
    if (!remoteSessionId || scanMode !== 'checkin') return
    const unsub = onSnapshot(
      collection(db, `scan_sessions/${remoteSessionId}/checkins`),
      async snap => {
        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue
          const { equipmentName } = change.doc.data()
          const match = items.find(i => i.status === 'checked-out' && i.equipmentName === equipmentName)
          if (match) {
            await updateDoc(doc(db, `inventory_projects/${project.id}/items`, match.id), {
              status: 'returned', checkinTimestamp: new Date().toISOString(),
            })
          }
          beep(660)
          setScanEntries(prev => [{ name: equipmentName, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)])
          setRemoteScanCount(c => c + 1)
        }
      },
    )
    return unsub
  }, [remoteSessionId, scanMode, items, project.id])

  // Count remote checkout scans by watching new items tagged with this session
  useEffect(() => {
    if (!remoteSessionId || scanMode !== 'checkout') return
    const unsub = onSnapshot(
      collection(db, `inventory_projects/${project.id}/items`),
      snap => {
        snap.docChanges().forEach(change => {
          if (change.type !== 'added') return
          const data = change.doc.data()
          if (data.scannedViaSession === remoteSessionId) {
            beep(880)
            setScanEntries(prev => [{ name: data.equipmentName, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)])
            setRemoteScanCount(c => c + 1)
          }
        })
      },
    )
    return unsub
  }, [remoteSessionId, scanMode, project.id])

  const [remoteError, setRemoteError] = useState('')

  async function startRemoteSession() {
    setRemoteError('')
    try {
      const ref = await addDoc(collection(db, 'scan_sessions'), {
        projectId: project.id,
        projectName: project.name,
        mode: scanMode,
        active: true,
        createdAt: serverTimestamp(),
      })
      setRemoteSessionId(ref.id)
      setRemoteScanCount(0)
      setScanEntries([])
    } catch (e: any) {
      setRemoteError(e?.message ?? 'Failed to start remote session')
    }
  }

  async function stopRemoteSession() {
    if (!remoteSessionId) return
    await updateDoc(doc(db, 'scan_sessions', remoteSessionId), { active: false }).catch(() => {})
    setRemoteSessionId(null)
  }

  async function startScanner() {
    setScanActive(true)
    const reader = new BrowserMultiFormatReader()
    try {
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current!,
        (result, err) => {
          if (result) {
            const text = result.getText()
            const now = Date.now()
            if (text === lastScanRef.current && now - lastScanTimeRef.current < 1500) return
            lastScanRef.current = text
            lastScanTimeRef.current = now
            beep(scanMode === 'checkout' ? 880 : 660)
            handleScan(text)
          }
          if (err && !(err instanceof NotFoundException)) {
            // silent
          }
        },
      )
      controlsRef.current = controls
    } catch {
      setScanActive(false)
    }
  }

  function stopScanner() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setScanActive(false)
  }

  // Cleanup remote session on unmount
  useEffect(() => {
    return () => { if (remoteSessionId) updateDoc(doc(db, 'scan_sessions', remoteSessionId), { active: false }).catch(() => {}) }
  }, [remoteSessionId])

  async function handleScan(text: string) {
    setScanEntries(prev => [{ name: text, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)])
    if (scanMode === 'checkout') {
      await addDoc(collection(db, `inventory_projects/${project.id}/items`), {
        equipmentId: '',
        equipmentName: text,
        checkoutTimestamp: new Date().toISOString(),
        checkinTimestamp: '',
        status: 'checked-out',
        damageNotes: '',
        assignedTo: project.borrowers?.[0] ?? '',
      })
    } else {
      const match = items.find(i => i.status === 'checked-out' && i.equipmentName === text)
      if (match) {
        await updateDoc(doc(db, `inventory_projects/${project.id}/items`, match.id), {
          status: 'returned',
          checkinTimestamp: new Date().toISOString(),
        })
      }
    }
  }

  async function addItemManual(name: string) {
    if (!name.trim()) return
    await addDoc(collection(db, `inventory_projects/${project.id}/items`), {
      equipmentId: '',
      equipmentName: name.trim(),
      checkoutTimestamp: new Date().toISOString(),
      checkinTimestamp: '',
      status: 'checked-out',
      damageNotes: '',
      assignedTo: project.borrowers?.[0] ?? '',
    })
    setManualInput('')
  }

  async function returnItem(item: InventoryItemDoc) {
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), {
      status: 'returned',
      checkinTimestamp: new Date().toISOString(),
    })
  }

  async function markMissing(item: InventoryItemDoc) {
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), { status: 'missing' })
  }

  async function saveDamage(item: InventoryItemDoc, note: string) {
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), {
      status: 'damaged',
      damageNotes: note,
    })
    setInlineDamage(prev => { const n = { ...prev }; delete n[item.id]; return n })
    setDamageEdit(prev => { const n = { ...prev }; delete n[item.id]; return n })
  }

  async function resolveDamage(item: InventoryItemDoc) {
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), {
      status: 'returned',
      damageNotes: '',
    })
  }

  async function removeItem(item: InventoryItemDoc) {
    await deleteDoc(doc(db, `inventory_projects/${project.id}/items`, item.id))
  }

  async function markAllReturned() {
    await onUpdate({ status: 'returned' })
    for (const item of items.filter(i => i.status === 'checked-out')) {
      await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), {
        status: 'returned',
        checkinTimestamp: new Date().toISOString(),
      })
    }
  }

  async function archiveProject() {
    await onUpdate({ status: 'archived' })
  }

  async function saveEdit() {
    await onUpdate({ name: editName, returnDate: editReturn })
    setEditing(false)
  }

  function generateContract() {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<html><head><title>Equipment Contract — ${project.name}</title></head><body>
      <h1>Equipment Contract</h1>
      <h2>${project.name}</h2>
      <p>Borrowers: ${project.borrowers?.join(', ')}</p>
      <p>Checkout: ${formatDate(project.checkoutDate)}</p>
      <p>Return: ${formatDate(project.returnDate)}</p>
      <h3>Items</h3>
      <ul>${items.map(i => `<li>${i.equipmentName} — ${i.status}</li>`).join('')}</ul>
      <p style="margin-top:40px">Signature: _______________________________</p>
    </body></html>`)
    win.print()
  }

  const itemStatusClass = (s: string) =>
    s === 'checked-out' ? 'item-status-checked-out' :
    s === 'returned' ? 'item-status-returned' :
    s === 'damaged' ? 'item-status-damaged' : 'item-status-missing'

  const statusRowClass = (s: string) => `status-row-${s}`

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {showPicker && (
        <EquipmentPicker
          onClose={() => setShowPicker(false)}
          onPick={name => { setShowPicker(false); addItemManual(name) }}
        />
      )}

      <button className="back-btn" onClick={onBack}>← Dashboard</button>

      {overdue && (
        <div className="missing-warning-banner">
          <AlertTriangle size={18} />
          <span>This project is <strong>{overdueDays(project.returnDate)} days overdue</strong>. Please return equipment.</span>
        </div>
      )}

      <div className="project-detail-header">
        <div style={{ flex: 1 }}>
          {editing ? (
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
              <input
                className="manual-add-input"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                style={{ flex: 1 }}
                placeholder="Project name"
              />
              <input
                className="manual-add-input"
                type="date"
                value={editReturn}
                onChange={e => setEditReturn(e.target.value)}
                style={{ width: 160 }}
              />
              <button className="manual-add-btn" onClick={saveEdit}>Save</button>
              <button className="secondary-btn" style={{ padding: '.4rem .8rem' }} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f0f0f5', margin: '0 0 .5rem' }}>
                {project.name}
              </h1>
              <div className="project-detail-meta">
                {project.borrowers?.length > 0 && (
                  <span><Users size={14} /> {project.borrowers.join(', ')}</span>
                )}
                <span><Calendar size={14} /> {formatDate(project.checkoutDate)} – {formatDate(project.returnDate)}</span>
                {project.equipmentManagerName && (
                  <span><Clock size={14} /> {project.equipmentManagerName}</span>
                )}
              </div>
            </>
          )}
        </div>
        <button className="secondary-btn" style={{ padding: '.4rem .75rem' }} onClick={() => setEditing(!editing)}>
          <Edit2 size={14} />
        </button>
      </div>

      <div className="project-actions">
        <button className="primary-btn" onClick={generateContract}>
          Download Contract PDF
        </button>
        {['active', 'checked-out'].includes(project.status) && (
          <button className="secondary-btn" onClick={async () => { await markAllReturned(); await archiveProject() }}>
            <CheckCircle2 size={16} /> Complete & Archive
          </button>
        )}
        {['returned', 'archived'].includes(project.status) && (
          <button className="secondary-btn" onClick={archiveProject}>
            <ArchiveRestore size={16} /> Archive
          </button>
        )}
      </div>

      {/* Scanner */}
      <div className={`scan-monitor${(scanActive || !!remoteSessionId) ? ' active' : ''}`}>
        {/* Mode tabs + action buttons */}
        <div className="scan-monitor-header">
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <button
              className={`category-btn${scanMode === 'checkout' ? ' active' : ''}`}
              style={{ borderRadius: 6 }}
              disabled={scanActive || !!remoteSessionId}
              onClick={() => setScanMode('checkout')}
            >Checkout</button>
            <button
              className={`category-btn${scanMode === 'checkin' ? ' active' : ''}`}
              style={{ borderRadius: 6 }}
              disabled={scanActive || !!remoteSessionId}
              onClick={() => setScanMode('checkin')}
            >Check-in</button>
          </div>
          <div className="scan-monitor-actions">
            {/* Local camera */}
            {!remoteSessionId && (
              scanActive
                ? <button className="scan-stop-btn" onClick={stopScanner}><ZapOff size={14} /> Stop</button>
                : <button className="manual-add-btn" onClick={startScanner}><Scan size={14} /> This Device</button>
            )}
            {/* Remote scanner */}
            {!scanActive && (
              remoteSessionId
                ? <button className="scan-stop-btn" onClick={stopRemoteSession}><ZapOff size={14} /> Stop</button>
                : <button className="manual-add-btn" style={{ background: 'rgba(76,217,100,.12)', borderColor: 'rgba(76,217,100,.3)', color: '#4cd964' }} onClick={startRemoteSession}>
                    <Smartphone size={14} /> Mobile
                  </button>
            )}
          </div>
        </div>

        {/* Local scan status */}
        {scanActive && (
          <div className="scan-monitor-status" style={{ marginBottom: '.75rem' }}>
            <div className="scan-pulse" />
            Scanning on this device ({scanMode})…
          </div>
        )}
        <video ref={videoRef} style={{ width: '100%', maxHeight: 240, borderRadius: 8, display: scanActive ? 'block' : 'none', background: '#000' }} />

        {/* Remote session: QR code for mobile to scan */}
        {remoteSessionId && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1rem 0' }}>
            <div className="scan-monitor-status">
              <div className="scan-pulse" />
              Remote session active ({scanMode}) — {remoteScanCount} scanned
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, display: 'inline-block' }}>
              <QRCodeSVG value={`${window.location.origin}/scan/${remoteSessionId}`} size={200} level="H" />
            </div>
            <p style={{ fontSize: '.8rem', color: '#6a6a80', textAlign: 'center', maxWidth: 280 }}>
              Scan this QR code on a mobile device to start scanning equipment into this project.
            </p>
            <p style={{ fontSize: '.65rem', color: '#4a4a60', fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'center', maxWidth: 320 }}>
              {window.location.origin}/scan/{remoteSessionId}
            </p>
          </div>
        )}

        {remoteError && (
          <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '8px 12px', fontSize: '.8rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} /> {remoteError}
          </div>
        )}

        {scanEntries.length === 0 && !scanActive && !remoteSessionId && (
          <div className="scan-waiting">
            Use <strong>This Device</strong> to scan with this camera, or <strong>Mobile Scanner</strong> to use a phone as a barcode scanner.
          </div>
        )}

        {scanEntries.length > 0 && (
          <>
            <div className="scan-list">
              {scanEntries.map((e, i) => (
                <div className="scan-entry" key={i}>
                  <span className="scan-entry-name">{e.name}</span>
                  <span className="scan-entry-time">{e.time}</span>
                </div>
              ))}
            </div>
            <div className="scan-count">{scanEntries.length} scanned this session</div>
          </>
        )}

        {scanActive && (
          <button className="scan-done-btn" onClick={stopScanner}>
            <Check size={16} /> Done Scanning
          </button>
        )}
      </div>

      {/* Manual add */}
      <div className="manual-add-section">
        <button className="equip-picker-open-btn" onClick={() => setShowPicker(true)}>
          <Plus size={16} /> Add Equipment from Catalog
        </button>
        <div className="manual-add-row">
          <input
            className="manual-add-input"
            placeholder="Or type equipment name..."
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItemManual(manualInput)}
          />
          <button
            className="manual-add-btn"
            disabled={!manualInput.trim()}
            onClick={() => addItemManual(manualInput)}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* Return summary */}
      {items.length > 0 && (
        <div className="return-summary-bar">
          <span className="return-stat returned"><Check size={14} /> {returnedCount} returned</span>
          <span className="return-stat checked-out"><Package size={14} /> {checkedOutCount} out</span>
          {missingCount > 0 && <span className="return-stat missing"><AlertTriangle size={14} /> {missingCount} missing</span>}
        </div>
      )}

      {/* Items list */}
      {items.length === 0 ? (
        <div className="inv-empty">No items added yet</div>
      ) : (
        <div className="project-items-list">
          {items.map(item => (
            <div key={item.id}>
              <div className={`project-item-row ${statusRowClass(item.status)}`}>
                <span className="project-item-name">{item.equipmentName}</span>
                <span className="project-item-time">
                  {item.checkoutTimestamp ? new Date(item.checkoutTimestamp).toLocaleString() : ''}
                </span>
                <span className={`project-item-status ${itemStatusClass(item.status)}`}>{item.status}</span>
                <div className="item-action-btns">
                  {item.status === 'checked-out' && (
                    <>
                      <button className="item-return-btn" title="Return" onClick={() => returnItem(item)}>
                        <Check size={16} />
                      </button>
                      <button
                        className="item-damage-toggle-btn"
                        title="Mark Damaged"
                        onClick={() => setInlineDamage(prev => ({ ...prev, [item.id]: '' }))}
                      >
                        <AlertTriangle size={14} />
                      </button>
                      <button className="item-missing-btn" title="Mark Missing" onClick={() => markMissing(item)}>
                        ?
                      </button>
                    </>
                  )}
                  {item.status === 'damaged' && (
                    <button className="item-return-btn" title="Resolved" onClick={() => resolveDamage(item)}>
                      <Check size={16} />
                    </button>
                  )}
                  {item.status === 'missing' && (
                    <button className="item-return-btn" title="Found" onClick={() => returnItem(item)}>
                      <Check size={16} />
                    </button>
                  )}
                  <button className="item-remove-btn" title="Remove" onClick={() => removeItem(item)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {item.status === 'damaged' && item.damageNotes && (
                <div className="checkin-inline-damage">
                  <span style={{ fontSize: '.8rem', color: '#ffa502' }}>{item.damageNotes}</span>
                </div>
              )}
              {inlineDamage[item.id] !== undefined && (
                <div className="checkin-inline-damage">
                  <input
                    className="checkin-damage-input"
                    placeholder="Describe damage..."
                    value={damageEdit[item.id] ?? ''}
                    onChange={e => setDamageEdit(prev => ({ ...prev, [item.id]: e.target.value }))}
                  />
                  <button
                    className="checkin-damage-save-btn"
                    disabled={!damageEdit[item.id]?.trim()}
                    onClick={() => saveDamage(item, damageEdit[item.id] ?? '')}
                  >
                    Save Damage
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Create Project Form ────────────────────────────────────────────────────────

function CreateProjectForm({
  onBack,
  onCreate,
}: {
  onBack: () => void
  onCreate: (id: string) => void
}) {
  const { profile } = useAuth()
  const [name, setName] = useState('')
  const [checkoutDate, setCheckoutDate] = useState(today())
  const [returnDate, setReturnDate] = useState('')
  const [borrowers, setBorrowers] = useState<string[]>([])
  const [borrowerInput, setBorrowerInput] = useState('')
  const [manager, setManager] = useState(profile?.displayName ?? '')
  const [managerId, setManagerId] = useState(profile?.uid ?? '')
  const [students, setStudents] = useState<UserDoc[]>([])
  const [teachers, setTeachers] = useState<UserDoc[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      const sq = await getDocs(query(collection(db, 'users'), where('role', '==', 'student')))
      setStudents(sq.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc)))
      const tq = await getDocs(query(collection(db, 'users'), where('role', 'in', ['teacher', 'admin'])))
      setTeachers(tq.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc)))
    }
    load()
  }, [])

  function addBorrower(n: string) {
    if (n.trim() && !borrowers.includes(n.trim())) {
      setBorrowers(prev => [...prev, n.trim()])
    }
    setBorrowerInput('')
  }

  function removeBorrower(n: string) {
    setBorrowers(prev => prev.filter(b => b !== n))
  }

  async function handleCreate() {
    if (!name || !returnDate) return
    setSubmitting(true)
    try {
      const ref = await addDoc(collection(db, 'inventory_projects'), {
        name,
        borrowers,
        borrowerIds: students.filter(s => borrowers.includes(s.displayName)).map(s => s.id),
        equipmentManagerId: managerId,
        equipmentManagerName: manager,
        cohortId: profile?.cohortId ?? '',
        checkoutDate,
        returnDate,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      onCreate(ref.id)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="inv-form-page">
      <button className="back-btn" onClick={onBack}>← Back</button>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f0f0f5', marginBottom: '1.5rem' }}>Create New Project</h2>

      <div className="inv-form">
        <div className="form-group">
          <label>Project Name</label>
          <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Group A - Short Film" />
        </div>

        <div className="form-group">
          <label>Borrowers</label>
          <div className="borrower-chips">
            {borrowers.map(b => (
              <span className="borrower-chip" key={b}>
                {b}
                <button className="borrower-chip-x" onClick={() => removeBorrower(b)}><X size={12} /></button>
              </span>
            ))}
          </div>
          {students.length > 0 && (
            <select
              className="form-select borrower-dropdown"
              onChange={e => { if (e.target.value) addBorrower(e.target.value); e.target.value = '' }}
            >
              <option value="">Select student...</option>
              {students.map(s => (
                <option key={s.id} value={s.displayName}>{s.displayName}</option>
              ))}
            </select>
          )}
          <div className="borrower-manual-row">
            <input
              type="text"
              className="form-input"
              placeholder="Or type name and press Enter"
              value={borrowerInput}
              onChange={e => setBorrowerInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addBorrower(borrowerInput) }}
            />
            <button className="manual-add-btn" onClick={() => addBorrower(borrowerInput)}>Add</button>
          </div>
        </div>

        <div className="form-group">
          <label>Equipment Manager</label>
          <select
            className="form-select"
            value={managerId}
            onChange={e => {
              setManagerId(e.target.value)
              const t = teachers.find(t => t.id === e.target.value)
              if (t) setManager(t.displayName)
            }}
          >
            {teachers.map(t => (
              <option key={t.id} value={t.id}>{t.displayName}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Checkout Date</label>
          <input type="date" className="form-input" value={checkoutDate} onChange={e => setCheckoutDate(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Return Date</label>
          <input type="date" className="form-input" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
        </div>

        <button
          className="primary-btn"
          disabled={submitting || !name || !returnDate}
          onClick={handleCreate}
        >
          {submitting ? 'Creating...' : 'Create Project'}
        </button>
      </div>
    </div>
  )
}

// ── useAllItems: collectionGroup query across all projects ────────────────────

function useAllItems() {
  const [items, setItems] = useState<(InventoryItemDoc & { projectId: string })[]>([])
  useEffect(() => {
    const unsub = onSnapshot(collectionGroup(db, 'items'), snap => {
      setItems(snap.docs.map(d => {
        const projectId = d.ref.parent.parent?.id ?? ''
        return { id: d.id, projectId, ...d.data() } as InventoryItemDoc & { projectId: string }
      }))
    })
    return unsub
  }, [])
  return items
}

// ── Main InventoryPage ─────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { data: projects } = useCollection<InventoryProjectDoc>('inventory_projects')
  const { data: equipment } = useCollection<EquipmentDoc>('equipment')
  const allItems = useAllItems()

  const [tab, setTab] = useState<InvTab>('dashboard')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [createProject, setCreateProject] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)

  const activeProjects = useMemo(
    () => projects.filter(p => ['active', 'checked-out'].includes(p.status))
      .sort((a, b) => (b.createdAt as any)?.seconds - (a.createdAt as any)?.seconds || 0),
    [projects],
  )
  const archivedProjects = useMemo(
    () => projects.filter(p => ['returned', 'archived'].includes(p.status))
      .sort((a, b) => (b.createdAt as any)?.seconds - (a.createdAt as any)?.seconds || 0),
    [projects],
  )
  const overdueProjects = activeProjects.filter(p => isOverdue(p.returnDate))

  // Items belonging to active projects only
  const activeProjectIds = useMemo(() => new Set(activeProjects.map(p => p.id)), [activeProjects])
  const activeItems = useMemo(() => allItems.filter(i => activeProjectIds.has(i.projectId)), [allItems, activeProjectIds])

  // Aggregate stats
  const stats = useMemo(() => ({
    itemsOut:     activeItems.filter(i => i.status === 'checked-out').length,
    returned:     activeItems.filter(i => i.status === 'returned').length,
    missing:      allItems.filter(i => i.status === 'missing').length,
    damaged:      allItems.filter(i => i.status === 'damaged').length,
    overdue:      overdueProjects.length,
  }), [activeItems, allItems, overdueProjects])

  async function updateProject(id: string, data: Partial<InventoryProjectDoc>) {
    await updateDoc(doc(db, 'inventory_projects', id), { ...data, updatedAt: serverTimestamp() })
  }

  const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) : null

  if (createProject) {
    return (
      <div className="molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh', padding: '1.5rem' }}>
        <CreateProjectForm
          onBack={() => setCreateProject(false)}
          onCreate={id => { setCreateProject(false); setSelectedProjectId(id) }}
        />
      </div>
    )
  }

  if (selectedProject) {
    return (
      <div className="molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh', padding: '1.5rem' }}>
        <ProjectDetail
          project={selectedProject}
          onBack={() => setSelectedProjectId(null)}
          onUpdate={(data) => updateProject(selectedProject.id, data)}
        />
      </div>
    )
  }

  return (
    <div className="molkom-app" style={{ background: '#0a0a0f', minHeight: '100vh' }}>
      <div className="inv-page">
        {/* Page title + new project button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div className="inv-page-title">
            <ArchiveRestore size={22} color="#4cd964" />
            Inventory
          </div>
          <button className="primary-btn" onClick={() => setCreateProject(true)}>
            <Plus size={16} /> New Project
          </button>
        </div>

        {/* Tabs */}
        <div className="inv-tabs">
          {([
            ['dashboard', 'Dashboard'],
            ['all-projects', 'All Projects'],
            ['equipment-status', 'Equipment Status'],
            ['borrower-stats', 'Borrower Stats'],
            ['statistics', 'Statistics'],
          ] as [InvTab, string][]).map(([id, label]) => (
            <button
              key={id}
              className={`inv-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Dashboard tab */}
        {tab === 'dashboard' && (
          <>
            <div className="inv-stats-row">
              <div className="inv-stat-card">
                <Package size={20} />
                <div>
                  <span className="inv-stat-value">{activeProjects.length}</span>
                  <span className="inv-stat-label">Active Projects</span>
                </div>
              </div>
              <div className="inv-stat-card">
                <Layers size={20} />
                <div>
                  <span className="inv-stat-value">{stats.itemsOut}</span>
                  <span className="inv-stat-label">Items Out</span>
                </div>
              </div>
              <div className="inv-stat-card">
                <Check size={20} />
                <div>
                  <span className="inv-stat-value">{stats.returned}</span>
                  <span className="inv-stat-label">Returned</span>
                </div>
              </div>
              <div className={`inv-stat-card${stats.overdue > 0 ? ' warning' : ''}`}>
                <Clock size={20} />
                <div>
                  <span className="inv-stat-value">{stats.overdue}</span>
                  <span className="inv-stat-label">Overdue</span>
                </div>
              </div>
              <div className={`inv-stat-card${stats.missing > 0 ? ' danger' : ''}`}>
                <AlertTriangle size={20} />
                <div>
                  <span className="inv-stat-value">{stats.missing}</span>
                  <span className="inv-stat-label">Missing</span>
                </div>
              </div>
              <div className={`inv-stat-card${stats.damaged > 0 ? ' warning' : ''}`}>
                <AlertTriangle size={20} />
                <div>
                  <span className="inv-stat-value">{stats.damaged}</span>
                  <span className="inv-stat-label">Damaged</span>
                </div>
              </div>
            </div>

            <div className="inv-section">
              <div className="inv-section-title"><Package size={18} /> Active Projects</div>
              {activeProjects.length === 0 ? (
                <div className="inv-empty">No active projects</div>
              ) : (
                <div className="project-grid">
                  {activeProjects.map(p => {
                    const pItems = allItems.filter(i => i.projectId === p.id)
                    return <ProjectCard key={p.id} project={p} items={pItems} onClick={() => setSelectedProjectId(p.id)} />
                  })}
                </div>
              )}
            </div>

            {archivedProjects.length > 0 && (
              <div className="inv-section">
                <button className="inv-section-toggle" onClick={() => setArchivedOpen(!archivedOpen)}>
                  {archivedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  Archived / Returned ({archivedProjects.length})
                </button>
                {archivedOpen && (
                  <div className="project-grid">
                    {archivedProjects.map(p => {
                      const pItems = allItems.filter(i => i.projectId === p.id)
                      return <ProjectCard key={p.id} project={p} items={pItems} onClick={() => setSelectedProjectId(p.id)} />
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* All Projects tab */}
        {tab === 'all-projects' && (
          <div className="inv-section">
            <div className="inv-section-title"><Layers size={18} /> All Projects</div>
            {projects.length === 0 ? (
              <div className="inv-empty">No projects yet</div>
            ) : (
              <div className="project-grid">
                {[...projects]
                  .sort((a, b) => (b.createdAt as any)?.seconds - (a.createdAt as any)?.seconds || 0)
                  .map(p => {
                    const pItems = allItems.filter(i => i.projectId === p.id)
                    return <ProjectCard key={p.id} project={p} items={pItems} onClick={() => setSelectedProjectId(p.id)} />
                  })}
              </div>
            )}
          </div>
        )}

        {/* Equipment Status tab */}
        {tab === 'equipment-status' && (
          <div className="inv-section">
            <div className="inv-section-title"><Package size={18} /> Equipment Status</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
                    {['Name', 'Category', 'Out', 'Returned', 'Missing', 'Damaged', 'Catalog'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '.5rem .75rem', color: '#6a6a80', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {equipment.filter(e => e.isActive).sort((a, b) => a.name.localeCompare(b.name)).map(e => {
                    const eItems = allItems.filter(i => i.equipmentName === e.name || i.equipmentId === e.id)
                    const out      = eItems.filter(i => i.status === 'checked-out').length
                    const returned = eItems.filter(i => i.status === 'returned').length
                    const missing  = eItems.filter(i => i.status === 'missing').length
                    const damaged  = eItems.filter(i => i.status === 'damaged').length
                    return (
                      <tr key={e.id} style={{ borderBottom: '1px solid #1a1a25' }}>
                        <td style={{ padding: '.5rem .75rem', color: '#f0f0f5' }}>{e.name}</td>
                        <td style={{ padding: '.5rem .75rem', color: '#4cd964', fontSize: '.7rem', fontWeight: 700 }}>{e.category}</td>
                        <td style={{ padding: '.5rem .75rem', color: out > 0 ? '#f97316' : '#4a4a60' }}>{out || '—'}</td>
                        <td style={{ padding: '.5rem .75rem', color: returned > 0 ? '#4cd964' : '#4a4a60' }}>{returned || '—'}</td>
                        <td style={{ padding: '.5rem .75rem', color: missing > 0 ? '#ff4757' : '#4a4a60', fontWeight: missing > 0 ? 700 : 400 }}>{missing || '—'}</td>
                        <td style={{ padding: '.5rem .75rem', color: damaged > 0 ? '#ffa502' : '#4a4a60', fontWeight: damaged > 0 ? 700 : 400 }}>{damaged || '—'}</td>
                        <td style={{ padding: '.5rem .75rem', color: e.available === 0 ? '#ff4757' : '#a0a0b5' }}>{e.available}/{e.totalQuantity}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Borrower Stats tab */}
        {tab === 'borrower-stats' && <BorrowerStats projects={projects} allItems={allItems} />}

        {/* Statistics tab */}
        {tab === 'statistics' && <StatsContent equipment={equipment} projects={projects} allItems={allItems} />}
      </div>
    </div>
  )
}

function BorrowerStats({ projects, allItems }: { projects: InventoryProjectDoc[]; allItems: (InventoryItemDoc & { projectId: string })[] }) {
  const [students, setStudents] = useState<UserDoc[]>([])

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('role', '==', 'student')))
      .then(snap => setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc))))
  }, [])

  // Only show borrowers who have at least one project
  const rows = useMemo(() => {
    const all = [...students, ...projects.flatMap(p =>
      (p.borrowers ?? []).filter(name => !students.find(s => s.displayName === name))
        .map(name => ({ id: '', displayName: name } as UserDoc))
    )]
    const seen = new Set<string>()
    return all.filter(s => {
      const key = s.id || s.displayName
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [students, projects])

  return (
    <div className="inv-section">
      <div className="inv-section-title"><Users size={18} /> Borrower Stats</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a3a' }}>
              {['Borrower', 'Projects', 'Active', 'Items Out', 'Returned', 'Missing', 'Damaged'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '.5rem .75rem', color: '#6a6a80', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, idx) => {
              const userProjects = projects.filter(p =>
                (s.id && p.borrowerIds?.includes(s.id)) || p.borrowers?.includes(s.displayName),
              )
              if (userProjects.length === 0) return null
              const active    = userProjects.filter(p => ['active', 'checked-out'].includes(p.status))
              const projIds   = new Set(userProjects.map(p => p.id))
              const userItems = allItems.filter(i => projIds.has(i.projectId))
              const out       = userItems.filter(i => i.status === 'checked-out').length
              const returned  = userItems.filter(i => i.status === 'returned').length
              const missing   = userItems.filter(i => i.status === 'missing').length
              const damaged   = userItems.filter(i => i.status === 'damaged').length
              return (
                <tr key={s.id || idx} style={{ borderBottom: '1px solid #1a1a25' }}>
                  <td style={{ padding: '.5rem .75rem', color: '#f0f0f5', fontWeight: 600 }}>{s.displayName}</td>
                  <td style={{ padding: '.5rem .75rem', color: '#a0a0b5' }}>{userProjects.length}</td>
                  <td style={{ padding: '.5rem .75rem', color: active.length > 0 ? '#4cd964' : '#4a4a60' }}>{active.length}</td>
                  <td style={{ padding: '.5rem .75rem', color: out > 0 ? '#f97316' : '#4a4a60' }}>{out || '—'}</td>
                  <td style={{ padding: '.5rem .75rem', color: returned > 0 ? '#4cd964' : '#4a4a60' }}>{returned || '—'}</td>
                  <td style={{ padding: '.5rem .75rem', color: missing > 0 ? '#ff4757' : '#4a4a60', fontWeight: missing > 0 ? 700 : 400 }}>{missing || '—'}</td>
                  <td style={{ padding: '.5rem .75rem', color: damaged > 0 ? '#ffa502' : '#4a4a60', fontWeight: damaged > 0 ? 700 : 400 }}>{damaged || '—'}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#6a6a80' }}>No borrowers found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
