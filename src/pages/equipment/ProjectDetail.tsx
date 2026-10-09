import { useState, useEffect, useRef, useMemo } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, onSnapshot, increment,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import type { EquipmentDoc, InventoryProjectDoc, InventoryItemDoc } from '@/types'
import {
  Package, Calendar, Users, Clock, AlertTriangle, Check, Trash2, Plus,
  Edit2, CheckCircle2, ArchiveRestore, ZapOff, Scan, Smartphone,
} from 'lucide-react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import { QRCodeSVG } from 'qrcode.react'
import { buildEquipmentContractHtml } from '@/lib/equipmentContract'
import { isOverdue, formatDate, overdueDays, parseScanText, beep } from './inventoryShared'
import { EquipmentPicker } from './EquipmentPicker'

export function ProjectDetail({
  project,
  onBack,
  onUpdate,
  onDelete,
}: {
  project: InventoryProjectDoc
  onBack: () => void
  onUpdate: (data: Partial<InventoryProjectDoc>) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const { data: items } = useCollection<InventoryItemDoc>(`inventory_projects/${project.id}/items`)
  const { data: equipmentAll } = useCollection<EquipmentDoc>('equipment')

  const [scanMode, setScanMode] = useState<'checkout' | 'checkin'>('checkout')
  const [scanActive, setScanActive] = useState(false)
  const [scanEntries, setScanEntries] = useState<{ name: string; time: string }[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionState, setActionState] = useState<'idle' | 'complete' | 'archive' | 'unarchive'>('idle')
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
            if (match.equipmentId) await adjustEquipmentAvailable(match.equipmentId, 1)
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

  // Equipment catalog "available" count reflects real-time checkout status
  // across every project — decrement when a unit leaves availability
  // (checked out or missing), increment when it comes back (returned).
  // Items not matched to a catalog entry (equipmentId blank) have nothing to adjust.
  async function adjustEquipmentAvailable(equipmentId: string, delta: number) {
    if (!equipmentId) return
    await updateDoc(doc(db, 'equipment', equipmentId), { available: increment(delta) })
  }

  async function handleScan(text: string) {
    setScanEntries(prev => [{ name: text, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)])
    const { base, unit } = parseScanText(text)
    const matchedEquip = equipmentAll.find(e => e.id === base || e.qrCode === base || e.name === base)
    const displayName = matchedEquip
      ? (unit ? `${matchedEquip.name} #${unit}` : matchedEquip.name)
      : text
    if (scanMode === 'checkout') {
      await addDoc(collection(db, `inventory_projects/${project.id}/items`), {
        equipmentId: matchedEquip?.id ?? '',
        equipmentName: displayName,
        checkoutTimestamp: new Date().toISOString(),
        checkinTimestamp: '',
        status: 'checked-out',
        damageNotes: '',
        assignedTo: project.borrowers?.[0] ?? '',
      })
      if (matchedEquip) await adjustEquipmentAvailable(matchedEquip.id, -1)
    } else {
      const match = items.find(i => i.status === 'checked-out' && i.equipmentName === displayName)
      if (match) {
        await updateDoc(doc(db, `inventory_projects/${project.id}/items`, match.id), {
          status: 'returned',
          checkinTimestamp: new Date().toISOString(),
        })
        if (match.equipmentId) await adjustEquipmentAvailable(match.equipmentId, 1)
      }
    }
  }

  async function addItemManual(name: string, equipmentId = '') {
    if (!name.trim()) return
    await addDoc(collection(db, `inventory_projects/${project.id}/items`), {
      equipmentId,
      equipmentName: name.trim(),
      checkoutTimestamp: new Date().toISOString(),
      checkinTimestamp: '',
      status: 'checked-out',
      damageNotes: '',
      assignedTo: project.borrowers?.[0] ?? '',
      // Typed by name, not chosen from the catalog picker — tracked separately in Statistics
      ...(equipmentId ? {} : { isManualEntry: true }),
    })
    if (equipmentId) await adjustEquipmentAvailable(equipmentId, -1)
    setManualInput('')
  }

  // Dismiss the inline "describe damage" input for an item — used whenever a
  // different action is taken on it, so a stale open input doesn't linger.
  function clearInlineDamage(itemId: string) {
    setInlineDamage(prev => { const n = { ...prev }; delete n[itemId]; return n })
    setDamageEdit(prev => { const n = { ...prev }; delete n[itemId]; return n })
  }

  async function returnItem(item: InventoryItemDoc) {
    clearInlineDamage(item.id)
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), {
      status: 'returned',
      checkinTimestamp: new Date().toISOString(),
    })
    // Covers both checked-out → returned and missing → returned ("Found") — both
    // are non-available states beforehand, so this is always a +1.
    if (item.equipmentId) await adjustEquipmentAvailable(item.equipmentId, 1)
  }

  // Undo an accidental return — checkoutTimestamp is left untouched, so the
  // item goes back to being checked out from its original checkout time.
  async function undoReturn(item: InventoryItemDoc) {
    clearInlineDamage(item.id)
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), {
      status: 'checked-out',
      checkinTimestamp: '',
    })
    if (item.equipmentId) await adjustEquipmentAvailable(item.equipmentId, -1)
  }

  async function markMissing(item: InventoryItemDoc) {
    clearInlineDamage(item.id)
    // checked-out → missing: both already non-available, no count change.
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), { status: 'missing' })
  }

  async function saveDamage(item: InventoryItemDoc, note: string) {
    // checked-out → damaged: both already non-available, no count change.
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), {
      status: 'damaged',
      damageNotes: note,
    })
    clearInlineDamage(item.id)
  }

  async function resolveDamage(item: InventoryItemDoc) {
    clearInlineDamage(item.id)
    await updateDoc(doc(db, `inventory_projects/${project.id}/items`, item.id), {
      status: 'returned',
      damageNotes: '',
      checkinTimestamp: new Date().toISOString(),
    })
    if (item.equipmentId) await adjustEquipmentAvailable(item.equipmentId, 1)
  }

  async function removeItem(item: InventoryItemDoc) {
    await deleteDoc(doc(db, `inventory_projects/${project.id}/items`, item.id))
    // Deleting a not-yet-returned item would otherwise permanently understate
    // availability — give the unit back unless it was already returned.
    if (item.equipmentId && item.status !== 'returned') await adjustEquipmentAvailable(item.equipmentId, 1)
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

  async function unarchiveProject() {
    await onUpdate({ status: 'active' })
  }

  async function withActionFlash(state: 'complete' | 'archive' | 'unarchive', action: () => Promise<void>) {
    setActionState(state)
    await Promise.all([action(), new Promise(r => setTimeout(r, 600))])
    setActionState('idle')
  }

  async function saveEdit() {
    await onUpdate({ name: editName, returnDate: editReturn })
    setEditing(false)
  }

  function generateContract() {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(buildEquipmentContractHtml({
      projectName: project.name,
      borrowerName: project.borrowers?.join(', ') ?? '',
      dateFrom: formatDate(project.checkoutDate),
      dateTo: formatDate(project.returnDate),
      items: items.map(i => ({
        product: i.equipmentName,
        time: i.checkoutTimestamp ? new Date(i.checkoutTimestamp).toLocaleString() : '',
      })),
    }))
    win.document.close()
    let printed = false
    const doPrint = () => { if (printed) return; printed = true; win.print() }
    win.addEventListener('load', doPrint)
    setTimeout(doPrint, 500)
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
          onPick={item => { setShowPicker(false); addItemManual(item.name, item.id) }}
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
        {((['active', 'checked-out'].includes(project.status) && actionState === 'idle') || actionState === 'complete') && (
          <button
            className="secondary-btn"
            disabled={actionState === 'complete'}
            style={actionState === 'complete' ? { background: '#4cd964', borderColor: '#4cd964', color: '#000' } : undefined}
            onClick={() => withActionFlash('complete', async () => { await markAllReturned(); await archiveProject() })}
          >
            {actionState === 'complete' ? <><Check size={16} /> Done!</> : <><CheckCircle2 size={16} /> Complete & Archive</>}
          </button>
        )}
        {((project.status === 'returned' && actionState === 'idle') || actionState === 'archive') && (
          <button
            className="secondary-btn"
            disabled={actionState === 'archive'}
            style={actionState === 'archive' ? { background: '#4cd964', borderColor: '#4cd964', color: '#000' } : undefined}
            onClick={() => withActionFlash('archive', archiveProject)}
          >
            {actionState === 'archive' ? <><Check size={16} /> Archived!</> : <><ArchiveRestore size={16} /> Archive</>}
          </button>
        )}
        {((project.status === 'archived' && actionState === 'idle') || actionState === 'unarchive') && (
          <button
            className="secondary-btn"
            disabled={actionState === 'unarchive'}
            style={actionState === 'unarchive' ? { background: '#4cd964', borderColor: '#4cd964', color: '#000' } : undefined}
            onClick={() => withActionFlash('unarchive', unarchiveProject)}
          >
            {actionState === 'unarchive' ? <><Check size={16} /> Unarchived!</> : <><ArchiveRestore size={16} /> Unarchive</>}
          </button>
        )}
        {confirmDelete ? (
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '.85rem', color: '#ff4757' }}>Delete this project permanently?</span>
            <button
              className="danger-btn"
              disabled={deleting}
              onClick={async () => { setDeleting(true); await onDelete() }}
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button className="secondary-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        ) : (
          <button className="secondary-btn danger-btn" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} /> Delete
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
                  {item.status === 'returned' && item.checkinTimestamp
                    ? new Date(item.checkinTimestamp).toLocaleString()
                    : item.checkoutTimestamp ? new Date(item.checkoutTimestamp).toLocaleString() : ''}
                </span>
                {item.status === 'returned' ? (
                  <button
                    className={`project-item-status ${itemStatusClass(item.status)}`}
                    style={{ cursor: 'pointer', border: 'none' }}
                    title="Undo — check this item back out"
                    onClick={() => undoReturn(item)}
                  >
                    {item.status}
                  </button>
                ) : (
                  <span className={`project-item-status ${itemStatusClass(item.status)}`}>{item.status}</span>
                )}
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
