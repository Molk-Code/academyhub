import { useState, useEffect } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { Mail, Save, CheckCircle2 } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useDocument } from '@/hooks/useFirestore'
import type { EmailConfigDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function EmailConfig() {
  const { data: config, loading } = useDocument<EmailConfigDoc>('email_config', 'global')

  const [foodBoxEmail, setFoodBoxEmail] = useState('')
  const [minivanEmail, setMinivanEmail] = useState('')
  const [fromName,  setFromName]  = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)

  useEffect(() => {
    if (config) {
      setFoodBoxEmail(config.foodBoxEmail ?? '')
      setMinivanEmail(config.minivanEmail ?? '')
      setFromName(config.fromName ?? '')
      setFromEmail(config.fromEmail ?? '')
    }
  }, [config])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await setDoc(doc(db, 'email_config', 'global'), {
        foodBoxEmail: foodBoxEmail.trim(),
        minivanEmail: minivanEmail.trim(),
        fromName:     fromName.trim(),
        fromEmail:    fromEmail.trim(),
      }, { merge: true })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Mail className="w-6 h-6 text-brand-500" />
        <div>
          <h1 className="page-title">Email Configuration</h1>
          <p className="text-zinc-500 text-sm">Set recipient addresses for order/booking notifications.</p>
        </div>
      </div>

      <form onSubmit={save} className="bg-zinc-900 rounded-2xl border border-white/10 p-6 space-y-5">
        <div>
          <label className="label text-xs">Sender name</label>
          <input
            value={fromName}
            onChange={e => setFromName(e.target.value)}
            className="input w-full"
            placeholder="CineForge"
          />
          <p className="text-xs text-zinc-400 mt-1">Displayed as "From" name in outgoing emails.</p>
        </div>
        <div>
          <label className="label text-xs">Sender email (verified in Resend) *</label>
          <input
            required
            type="email"
            value={fromEmail}
            onChange={e => setFromEmail(e.target.value)}
            className="input w-full"
            placeholder="noreply@yourdomain.com"
          />
          <p className="text-xs text-zinc-400 mt-1">Must be a verified sender address in your Resend account.</p>
        </div>
        <div>
          <label className="label text-xs">Food Box Order recipient *</label>
          <input
            required
            type="email"
            value={foodBoxEmail}
            onChange={e => setFoodBoxEmail(e.target.value)}
            className="input w-full"
            placeholder="kitchen@school.se"
          />
        </div>
        <div>
          <label className="label text-xs">Vehicle Booking recipient *</label>
          <input
            required
            type="email"
            value={minivanEmail}
            onChange={e => setMinivanEmail(e.target.value)}
            className="input w-full"
            placeholder="admin@school.se"
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex items-center gap-2 py-2 px-5"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
        </div>
      </form>

      <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-sm text-zinc-400 space-y-1">
        <p className="font-semibold text-zinc-300">Resend API key</p>
        <p>The API key is stored securely in Firebase Secret Manager. To rotate it:</p>
        <code className="block bg-zinc-800 rounded-lg px-3 py-2 text-xs mt-2 font-mono whitespace-pre-wrap">
          {`firebase functions:secrets:set RESEND_API_KEY`}
        </code>
      </div>
    </div>
  )
}
