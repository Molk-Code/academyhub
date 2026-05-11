import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import type { QrDisplayDeviceDoc } from '@/types'
import { Plus, Trash2, Monitor, Copy, ExternalLink, ToggleLeft, ToggleRight } from 'lucide-react'

const MAX_DEVICES = 10

function UrlCard({ url, accentColor }: { url: string; accentColor: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="bg-zinc-900 rounded-xl border border-white/8 overflow-hidden"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <div className="px-5 py-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">
            QR Display URL
          </p>
          <p className="font-mono text-sm text-zinc-200 truncate">{url}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 btn-secondary py-1.5 px-3 text-sm"
          >
            Open <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 btn-secondary py-1.5 px-3 text-sm"
          >
            {copied ? 'Copied!' : <><Copy className="w-3.5 h-3.5" /> Copy URL</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function QrDevices() {
  const { data: devices, loading } = useCollection<QrDisplayDeviceDoc>('qr_display_devices')
  const [newName, setNewName]   = useState('')
  const [adding, setAdding]     = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const displayUrl = `${window.location.origin}/qr-display`

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name || devices.length >= MAX_DEVICES) return
    setAdding(true)
    try {
      await addDoc(collection(db, 'qr_display_devices'), {
        name,
        isActive: true,
        createdAt: serverTimestamp(),
      })
      setNewName('')
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(device: QrDisplayDeviceDoc) {
    await updateDoc(doc(db, 'qr_display_devices', device.id), { isActive: !device.isActive })
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try { await deleteDoc(doc(db, 'qr_display_devices', id)) }
    finally { setDeleting(null) }
  }

  const sorted = [...devices].sort((a, b) =>
    (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0),
  )

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="page-title">QR Check-in Devices</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Manage external displays (TVs, tablets) that show rotating attendance QR codes.
        </p>
      </div>

      <UrlCard url={displayUrl} accentColor="#8b5cf6" />

      {/* Add device form */}
      <section className="card space-y-4">
        <h2 className="text-base font-semibold text-zinc-200 flex items-center gap-2">
          <Monitor className="w-4 h-4 text-brand-400" /> Add Device
        </h2>
        {devices.length >= MAX_DEVICES && (
          <p className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
            Maximum of {MAX_DEVICES} devices reached.
          </p>
        )}
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Classroom TV, Studio Display"
            className="input flex-1 text-sm"
            maxLength={60}
            disabled={devices.length >= MAX_DEVICES}
          />
          <button
            type="submit"
            disabled={!newName.trim() || adding || devices.length >= MAX_DEVICES}
            className="btn-primary py-2 px-4 text-sm flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            {adding ? 'Adding…' : 'Add'}
          </button>
        </form>
      </section>

      {/* Device list */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-200">
          Devices <span className="text-zinc-500 font-normal">({sorted.length}/{MAX_DEVICES})</span>
        </h2>
        {loading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-zinc-500 text-sm">No devices yet. Add one above.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map(device => (
              <div
                key={device.id}
                className="card flex items-center gap-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-100">{device.name}</p>
                  <a
                    href={`/qr-display?device=${device.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-500 hover:text-brand-400 transition-colors font-mono"
                  >
                    /qr-display?device={device.id.slice(0, 12)}…
                  </a>
                </div>

                <button
                  onClick={() => handleToggle(device)}
                  className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                    device.isActive ? 'text-emerald-400 hover:text-zinc-400' : 'text-zinc-500 hover:text-emerald-400'
                  }`}
                  title={device.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                >
                  {device.isActive
                    ? <ToggleRight className="w-5 h-5" />
                    : <ToggleLeft className="w-5 h-5" />}
                  <span className="hidden sm:inline">{device.isActive ? 'Active' : 'Inactive'}</span>
                </button>

                <button
                  onClick={() => handleDelete(device.id)}
                  disabled={deleting === device.id}
                  className="p-2 text-zinc-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-rose-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
