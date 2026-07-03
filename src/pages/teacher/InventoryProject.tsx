import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument, useCollection } from '@/hooks/useFirestore'
import type { InventoryProjectDoc, InventoryItemDoc, EquipmentDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import {
  Package,
  Scan,
  Check,
  X,
  AlertTriangle,
  Plus,
  Printer,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

// ─── helpers ────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function fmtTs(ts: string) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
  } catch { return ts }
}

function playBeep(freq: number) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
    osc.onended = () => ctx.close()
  } catch { /* ignore */ }
}

function statusBadge(status: InventoryItemDoc['status']) {
  switch (status) {
    case 'checked-out': return 'bg-blue-950/50 text-blue-400 border-blue-800/50'
    case 'returned':    return 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50'
    case 'damaged':     return 'bg-amber-950/50 text-amber-400 border-amber-800/50'
    case 'missing':     return 'bg-red-950/50 text-red-400 border-red-800/50'
  }
}

function projectStatusBadge(status: InventoryProjectDoc['status']) {
  switch (status) {
    case 'active':      return 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50'
    case 'checked-out': return 'bg-blue-950/50 text-blue-400 border-blue-800/50'
    case 'returned':    return 'bg-zinc-800 text-zinc-400 border-zinc-700'
    case 'archived':    return 'bg-zinc-800 text-zinc-500 border-zinc-700'
  }
}

// ─── Addon session modal ─────────────────────────────────────────────────────

interface AddonSession {
  date: string
  collectedBy: string
  manager: string
}

interface AddonModalProps {
  onClose: () => void
  onSave: (session: AddonSession) => void
}

function AddonModal({ onClose, onSave }: AddonModalProps) {
  const [date, setDate]             = useState(today())
  const [collectedBy, setCollectedBy] = useState('')
  const [manager, setManager]       = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-zinc-100">Add Extra Items Session</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input w-full" />
        </div>
        <div>
          <label className="label">Collected by</label>
          <input
            type="text"
            value={collectedBy}
            onChange={e => setCollectedBy(e.target.value)}
            className="input w-full"
            placeholder="Name of person collecting"
          />
        </div>
        <div>
          <label className="label">Manager</label>
          <input
            type="text"
            value={manager}
            onChange={e => setManager(e.target.value)}
            className="input w-full"
            placeholder="Issuing manager"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-white/10 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ date, collectedBy, manager })}
            className="flex-1 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors"
          >
            Start Session
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function InventoryProject() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  // Firestore data
  const { data: project, loading: projectLoading } = useDocument<InventoryProjectDoc>(
    'inventory_projects',
    projectId,
  )
  const { data: items, loading: itemsLoading } = useCollection<InventoryItemDoc>(
    `inventory_projects/${projectId}/items`,
    [],
    !!projectId,
    projectId ?? '',
  )
  const { data: equipment } = useCollection<EquipmentDoc>('equipment', [])

  // Scanner
  const [scanMode, setScanMode]         = useState<'checkout' | 'checkin'>('checkout')
  const [scannerActive, setScannerActive] = useState(false)
  const [scanFeedback, setScanFeedback] = useState('')
  const [recentScans, setRecentScans]   = useState<string[]>([])
  const videoRef  = useRef<HTMLVideoElement>(null)
  const lastScanRef = useRef<{ name: string; time: number }>({ name: '', time: 0 })

  // Manual add
  const [equipSearch, setEquipSearch]   = useState('')
  const [manualName, setManualName]     = useState('')

  // Item inline damage notes
  const [damageInputs, setDamageInputs] = useState<Record<string, string>>({})

  // Addon session
  const [addonSession, setAddonSession]   = useState<AddonSession | null>(null)
  const [showAddonModal, setShowAddonModal] = useState(false)

  // Archived toggle
  const [addonsOpen, setAddonsOpen] = useState(false)

  // ── Scanner effect ────────────────────────────────────────────────────────

  const handleScan = useCallback(async (qrValue: string) => {
    const now = Date.now()
    if (
      qrValue === lastScanRef.current.name &&
      now - lastScanRef.current.time < 500
    ) return
    lastScanRef.current = { name: qrValue, time: now }

    if (scanMode === 'checkout') {
      playBeep(880)
      const equip = equipment.find(
        e => e.qrCode === qrValue || e.name === qrValue,
      )
      await addDoc(
        collection(db, `inventory_projects/${projectId}/items`),
        {
          equipmentId:        equip?.id ?? '',
          equipmentName:      equip?.name ?? qrValue,
          checkoutTimestamp:  new Date().toISOString(),
          checkinTimestamp:   '',
          status:             'checked-out',
          damageNotes:        '',
          assignedTo:         '',
          ...(addonSession
            ? {
                addonDate:        addonSession.date,
                addonCollectedBy: addonSession.collectedBy,
                addonManager:     addonSession.manager,
              }
            : {}),
        },
      )
      const label = equip?.name ?? qrValue
      setScanFeedback(`✓ Checked out: ${label}`)
      setRecentScans(prev => [`[OUT] ${label}`, ...prev].slice(0, 5))
    } else {
      playBeep(660)
      const match = items.find(
        i => i.equipmentName === qrValue && i.status === 'checked-out',
      )
      if (match) {
        await updateDoc(
          doc(db, `inventory_projects/${projectId}/items`, match.id),
          { status: 'returned', checkinTimestamp: new Date().toISOString() },
        )
        setScanFeedback(`✓ Checked in: ${match.equipmentName}`)
        setRecentScans(prev => [`[IN] ${match.equipmentName}`, ...prev].slice(0, 5))
      } else {
        setScanFeedback(`⚠ Not found or already returned: ${qrValue}`)
        setRecentScans(prev => [`[??] ${qrValue}`, ...prev].slice(0, 5))
      }
    }

    setTimeout(() => setScanFeedback(''), 2000)
  }, [scanMode, equipment, items, projectId, addonSession])

  useEffect(() => {
    if (!scannerActive) return

    const reader = new BrowserMultiFormatReader()
    let stopped  = false
    let controls: { stop: () => void } | null = null

    const start = async () => {
      try {
        if (!videoRef.current) return
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoRef.current,
          (result, error) => {
            if (result && !stopped) {
              handleScan(result.getText())
            }
            if (error && !(error instanceof NotFoundException)) { /* ignore */ }
          },
        )
      } catch (err) {
        console.error('Scanner error:', err)
      }
    }
    start()

    return () => {
      stopped = true
      controls?.stop()
    }
  }, [scannerActive, handleScan])

  // ── Manual add helpers ────────────────────────────────────────────────────

  async function addItem(name: string, equipId = '') {
    await addDoc(
      collection(db, `inventory_projects/${projectId}/items`),
      {
        equipmentId:       equipId,
        equipmentName:     name,
        checkoutTimestamp: new Date().toISOString(),
        checkinTimestamp:  '',
        status:            'checked-out',
        damageNotes:       '',
        assignedTo:        '',
        ...(addonSession
          ? {
              addonDate:        addonSession.date,
              addonCollectedBy: addonSession.collectedBy,
              addonManager:     addonSession.manager,
            }
          : {}),
      },
    )
  }

  async function updateItemStatus(
    itemId: string,
    status: InventoryItemDoc['status'],
    extra: Record<string, string> = {},
  ) {
    await updateDoc(doc(db, `inventory_projects/${projectId}/items`, itemId), {
      status,
      ...(status === 'returned' ? { checkinTimestamp: new Date().toISOString() } : {}),
      ...extra,
    })
  }

  // ── Project archive toggle ────────────────────────────────────────────────

  async function toggleArchive() {
    if (!project) return
    const newStatus = project.status === 'archived' ? 'active' : 'archived'
    await updateDoc(doc(db, 'inventory_projects', project.id), {
      status:    newStatus,
      updatedAt: serverTimestamp(),
    })
  }

  // ── Print contract ────────────────────────────────────────────────────────

  function printContract() {
    if (!project) return
    const rows = items
      .map(
        i =>
          `<tr>
            <td style="border:1px solid #ccc;padding:6px 10px">${i.equipmentName}</td>
            <td style="border:1px solid #ccc;padding:6px 10px">${i.status}</td>
            <td style="border:1px solid #ccc;padding:6px 10px">${fmtTs(i.checkoutTimestamp)}</td>
            <td style="border:1px solid #ccc;padding:6px 10px">${fmtTs(i.checkinTimestamp)}</td>
          </tr>`,
      )
      .join('')

    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <html><head><title>${project.name} — Equipment Contract</title></head>
      <body style="font-family:sans-serif;padding:32px;color:#111">
        <h1 style="margin-bottom:4px">${project.name}</h1>
        <p style="color:#555;margin:0 0 4px">Borrowers: ${project.borrowers.join(', ') || '—'}</p>
        <p style="color:#555;margin:0 0 4px">Manager: ${project.equipmentManagerName}</p>
        <p style="color:#555;margin:0 0 20px">Period: ${project.checkoutDate} → ${project.returnDate}</p>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f0f0f0">
              <th style="border:1px solid #ccc;padding:6px 10px;text-align:left">Equipment</th>
              <th style="border:1px solid #ccc;padding:6px 10px;text-align:left">Status</th>
              <th style="border:1px solid #ccc;padding:6px 10px;text-align:left">Checkout</th>
              <th style="border:1px solid #ccc;padding:6px 10px;text-align:left">Return</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:40px;color:#888;font-size:12px">Generated ${new Date().toLocaleString()}</p>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  // ── Filtered equipment catalog ────────────────────────────────────────────

  const filteredEquipment = equipment.filter(
    e =>
      e.isActive &&
      (!equipSearch || e.name.toLowerCase().includes(equipSearch.toLowerCase())),
  )

  // ── Loading / not found ───────────────────────────────────────────────────

  if (projectLoading || itemsLoading) return <LoadingSpinner />

  if (!project) {
    return (
      <div className="text-center py-20">
        <Package className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
        <p className="text-zinc-400">Project not found.</p>
        <button onClick={() => navigate('/teacher/inventory')} className="mt-4 text-orange-400 hover:text-orange-300 text-sm">
          ← Back to inventory
        </button>
      </div>
    )
  }

  const todayStr       = today()
  const isOverdue      = project.returnDate < todayStr && project.status !== 'returned' && project.status !== 'archived'
  const overdueDays    = isOverdue ? Math.floor((new Date(todayStr).getTime() - new Date(project.returnDate).getTime()) / 86400000) : 0

  return (
    <div className="space-y-6 pb-16">
      {/* Back */}
      <button
        onClick={() => navigate('/teacher/inventory')}
        className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        ← Inventory
      </button>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/8 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-zinc-100">{project.name}</h1>
              <span className={cn('text-xs font-medium px-2.5 py-0.5 rounded-full border capitalize', projectStatusBadge(project.status))}>
                {project.status}
              </span>
              {isOverdue && (
                <span className="flex items-center gap-1 text-xs font-semibold bg-red-950/60 text-red-400 border border-red-800/50 px-2 py-0.5 rounded-full">
                  <AlertTriangle className="w-3 h-3" /> {overdueDays}d overdue
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-400 mb-1">
              {project.borrowers.length > 0 ? project.borrowers.join(', ') : 'No borrowers'}
            </p>
            <p className="text-xs text-zinc-500">
              Manager: {project.equipmentManagerName} · {project.checkoutDate} → {project.returnDate}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={printContract}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 border border-white/10 hover:border-white/20 px-3 py-2 rounded-xl transition-colors"
            >
              <Printer className="w-4 h-4" /> Contract
            </button>
            <button
              onClick={toggleArchive}
              className={cn(
                'text-sm font-medium px-3 py-2 rounded-xl border transition-colors',
                project.status === 'archived'
                  ? 'border-emerald-700/50 text-emerald-400 hover:bg-emerald-950/30'
                  : 'border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20',
              )}
            >
              {project.status === 'archived' ? 'Unarchive' : 'Archive'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Scanner ─────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/8 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Scan className="w-4 h-4 text-zinc-400" />
            <span className="font-semibold text-zinc-200 text-sm">Scanner</span>
          </div>
          {/* Mode tabs */}
          <div className="flex gap-1 bg-zinc-800 rounded-xl p-1">
            {(['checkout', 'checkin'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setScanMode(mode)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors',
                  scanMode === mode
                    ? 'bg-orange-500 text-white'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                {mode === 'checkout' ? 'Checkout' : 'Check-in'}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Video */}
          <div className="relative aspect-video max-w-sm mx-auto rounded-xl overflow-hidden bg-black border border-white/8">
            <video
              ref={videoRef}
              className={cn('w-full h-full object-cover', !scannerActive && 'hidden')}
              autoPlay
              muted
              playsInline
            />
            {!scannerActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <Scan className="w-10 h-10 text-zinc-700" />
                <p className="text-xs text-zinc-500">Scanner off</p>
              </div>
            )}
            {scannerActive && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-40 h-40 border-2 border-white/60 rounded-lg" />
              </div>
            )}
          </div>

          {/* Feedback */}
          {scanFeedback && (
            <div className="text-sm font-medium text-center text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 rounded-xl px-3 py-2">
              {scanFeedback}
            </div>
          )}

          <button
            onClick={() => setScannerActive(v => !v)}
            className={cn(
              'w-full py-2.5 rounded-xl font-semibold text-sm transition-colors',
              scannerActive
                ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'
                : 'bg-orange-500 hover:bg-orange-600 text-white',
            )}
          >
            {scannerActive ? 'Stop Scanner' : 'Start Scanner'}
          </button>

          {/* Recent scans */}
          {recentScans.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-zinc-500 font-medium">Recent scans</p>
              {recentScans.map((s, i) => (
                <p key={i} className="text-xs text-zinc-400 font-mono bg-zinc-800/50 rounded-lg px-3 py-1.5">
                  {s}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Manual add ──────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/8 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-zinc-400" />
          <span className="font-semibold text-zinc-200 text-sm">Add Equipment Manually</span>
        </div>

        {/* Catalog search */}
        <div>
          <input
            type="text"
            value={equipSearch}
            onChange={e => setEquipSearch(e.target.value)}
            className="input w-full"
            placeholder="Search equipment catalog…"
          />
          {equipSearch && filteredEquipment.length > 0 && (
            <div className="mt-1 bg-zinc-800 border border-white/10 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
              {filteredEquipment.slice(0, 12).map(e => (
                <button
                  key={e.id}
                  type="button"
                  onClick={async () => { await addItem(e.name, e.id); setEquipSearch('') }}
                  className="w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors flex items-center justify-between"
                >
                  <span>{e.name}</span>
                  <span className="text-xs text-zinc-500">{e.category}</span>
                </button>
              ))}
            </div>
          )}
          {equipSearch && filteredEquipment.length === 0 && (
            <p className="text-xs text-zinc-500 mt-1 px-1">No equipment found in catalog.</p>
          )}
        </div>

        {/* Free-text add */}
        <div className="flex gap-2">
          <input
            type="text"
            value={manualName}
            onChange={e => setManualName(e.target.value)}
            onKeyDown={async e => {
              if (e.key === 'Enter' && manualName.trim()) {
                await addItem(manualName.trim())
                setManualName('')
              }
            }}
            className="input flex-1"
            placeholder="Add by name (not in catalog)…"
          />
          <button
            type="button"
            onClick={async () => {
              if (!manualName.trim()) return
              await addItem(manualName.trim())
              setManualName('')
            }}
            className="px-4 py-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {/* ── Items list ──────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 rounded-2xl border border-white/8 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
          <span className="font-semibold text-zinc-200 text-sm">Items ({items.length})</span>
          <button
            onClick={() => setShowAddonModal(true)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-white/10 hover:border-white/20 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Addon Session
          </button>
        </div>

        {/* Active addon session banner */}
        {addonSession && (
          <div className="px-5 py-2.5 bg-amber-950/30 border-b border-amber-800/30 flex items-center justify-between gap-2">
            <p className="text-xs text-amber-300">
              Addon session active · {addonSession.date} · {addonSession.collectedBy}
            </p>
            <button onClick={() => setAddonSession(null)} className="text-amber-500 hover:text-amber-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-zinc-500 text-sm">No items yet. Scan or add manually.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/6">
            {items.map(item => {
              const isDamageInputOpen = item.status === 'checked-out' || item.status === 'damaged'
              return (
                <div key={item.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-zinc-100 text-sm">{item.equipmentName}</span>
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border capitalize', statusBadge(item.status))}>
                          {item.status}
                        </span>
                        {item.addonDate && (
                          <span className="text-xs text-amber-400 bg-amber-950/30 border border-amber-800/30 px-1.5 py-0.5 rounded-full">
                            addon
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">
                        Out: {fmtTs(item.checkoutTimestamp)}
                        {item.checkinTimestamp && ` · In: ${fmtTs(item.checkinTimestamp)}`}
                      </p>
                      {item.damageNotes && (
                        <p className="text-xs text-amber-400 mt-1 bg-amber-950/20 rounded-lg px-2 py-1">
                          {item.damageNotes}
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.status === 'checked-out' && (
                        <>
                          <button
                            onClick={() => updateItemStatus(item.id, 'returned')}
                            className="flex items-center gap-1 text-xs bg-emerald-950/50 text-emerald-400 hover:bg-emerald-900/60 border border-emerald-800/50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <Check className="w-3 h-3" /> Return
                          </button>
                          <button
                            onClick={() => {
                              const notes = damageInputs[item.id]?.trim()
                              if (!notes) {
                                setDamageInputs(prev => ({ ...prev, [item.id]: prev[item.id] ?? '' }))
                              } else {
                                updateItemStatus(item.id, 'damaged', { damageNotes: notes })
                                setDamageInputs(prev => { const n = { ...prev }; delete n[item.id]; return n })
                              }
                            }}
                            className="flex items-center gap-1 text-xs bg-amber-950/50 text-amber-400 hover:bg-amber-900/60 border border-amber-800/50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <AlertTriangle className="w-3 h-3" /> Damaged
                          </button>
                          <button
                            onClick={() => updateItemStatus(item.id, 'missing')}
                            className="flex items-center gap-1 text-xs bg-red-950/50 text-red-400 hover:bg-red-900/60 border border-red-800/50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <X className="w-3 h-3" /> Missing
                          </button>
                        </>
                      )}
                      {item.status === 'damaged' && (
                        <button
                          onClick={() => updateItemStatus(item.id, 'returned')}
                          className="flex items-center gap-1 text-xs bg-emerald-950/50 text-emerald-400 hover:bg-emerald-900/60 border border-emerald-800/50 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <Check className="w-3 h-3" /> Resolved
                        </button>
                      )}
                      {item.status === 'missing' && (
                        <button
                          onClick={() => updateItemStatus(item.id, 'returned')}
                          className="flex items-center gap-1 text-xs bg-emerald-950/50 text-emerald-400 hover:bg-emerald-900/60 border border-emerald-800/50 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <Check className="w-3 h-3" /> Found
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline damage note input */}
                  {isDamageInputOpen && item.id in damageInputs && (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={damageInputs[item.id]}
                        onChange={e =>
                          setDamageInputs(prev => ({ ...prev, [item.id]: e.target.value }))
                        }
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const notes = damageInputs[item.id]?.trim()
                            if (notes) {
                              updateItemStatus(item.id, 'damaged', { damageNotes: notes })
                              setDamageInputs(prev => { const n = { ...prev }; delete n[item.id]; return n })
                            }
                          }
                          if (e.key === 'Escape') {
                            setDamageInputs(prev => { const n = { ...prev }; delete n[item.id]; return n })
                          }
                        }}
                        className="input flex-1 text-sm"
                        placeholder="Describe the damage…"
                      />
                      <button
                        onClick={() => {
                          const notes = damageInputs[item.id]?.trim()
                          if (notes) {
                            updateItemStatus(item.id, 'damaged', { damageNotes: notes })
                          }
                          setDamageInputs(prev => { const n = { ...prev }; delete n[item.id]; return n })
                        }}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Addon section toggle */}
        {items.some(i => i.addonDate) && (
          <div className="border-t border-white/8">
            <button
              onClick={() => setAddonsOpen(o => !o)}
              className="w-full flex items-center gap-2 px-5 py-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {addonsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Addon items ({items.filter(i => i.addonDate).length})
            </button>
            {addonsOpen && (
              <div className="divide-y divide-white/6 px-5 pb-3">
                {items
                  .filter(i => i.addonDate)
                  .map(item => (
                    <div key={item.id} className="py-2">
                      <p className="text-sm text-zinc-300">{item.equipmentName}</p>
                      <p className="text-xs text-zinc-500">
                        {item.addonDate} · {item.addonCollectedBy} · {item.addonManager}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Addon modal */}
      {showAddonModal && (
        <AddonModal
          onClose={() => setShowAddonModal(false)}
          onSave={session => {
            setAddonSession(session)
            setShowAddonModal(false)
          }}
        />
      )}
    </div>
  )
}
