import { useState, useEffect } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument } from '@/hooks/useFirestore'
import type { ChatSettingsDoc } from '@/types'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const RETENTION_OPTIONS: { label: string; value: number | null }[] = [
  { label: '7 days',    value: 7   },
  { label: '14 days',   value: 14  },
  { label: '30 days',   value: 30  },
  { label: '60 days',   value: 60  },
  { label: '90 days',   value: 90  },
  { label: '180 days',  value: 180 },
  { label: '1 year',    value: 365 },
  { label: 'Forever',   value: null },
]

export function ChatGlobalSettingsModal({ onClose }: { onClose: () => void }) {
  const { data: settings } = useDocument<ChatSettingsDoc & { id: string }>('chat_settings', 'global')
  const [retentionDays, setRetentionDays] = useState<number | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings !== null && retentionDays === undefined) {
      setRetentionDays(settings?.retentionDays ?? null)
    }
  }, [settings])

  async function save() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'chat_settings', 'global'), { retentionDays })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const current = retentionDays === undefined ? (settings?.retentionDays ?? null) : retentionDays

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl border border-white/10 w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-zinc-100">Chat settings</h2>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-sm font-semibold text-zinc-300 block mb-1">Message retention</label>
            <p className="text-xs text-zinc-400 mb-3">Messages older than this will be automatically deleted.</p>
            <div className="grid grid-cols-2 gap-1.5">
              {RETENTION_OPTIONS.map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => setRetentionDays(opt.value)}
                  className={cn(
                    'px-3 py-2 rounded-xl text-sm font-medium border transition-all',
                    current === opt.value
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'border-white/10 text-zinc-400 hover:border-white/15 hover:bg-white/5',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-white/10">
          <button
            onClick={save}
            disabled={saving || retentionDays === undefined}
            className="btn-primary py-2 px-5 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-secondary py-2 px-4">Cancel</button>
        </div>
      </div>
    </div>
  )
}
