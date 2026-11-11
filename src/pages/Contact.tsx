import { useState } from 'react'
import { Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { ArrowLeft, CheckCircle2, AlertCircle, Mail } from 'lucide-react'
import { functions } from '@/lib/firebase'
import { useLegal } from '@/lib/publicConfig'
import { ProviderDetails } from '@/components/LegalFooter'

// All UI text in one place so it can be translated (e.g. to Swedish) later
const TEXT = {
  title:        'Contact us',
  intro:        'Schools, partners and anyone with a question about the service, including legal or trademark matters, can reach us here.',
  back:         'Back to sign in',
  name:         'Name',
  email:        'Email',
  organisation: 'Organisation (optional)',
  category:     'Subject',
  categories: {
    school_enquiry: 'School enquiry',
    support:        'Support',
    legal:          'Legal or trademark',
  },
  message:      'Message',
  messageHint:  '10–4000 characters',
  consentBefore: 'We store your name, email, organisation and message to answer you. Read more in our ',
  consentLink:   'privacy policy',
  consentAfter:  '.',
  submit:       'Send message',
  sending:      'Sending…',
  successTitle: 'Thanks — your message has been sent',
  successBody:  'We usually reply within a few working days.',
  sendAnother:  'Send another message',
  errorLimit:   'Too many messages right now. Please try again later, or email us directly.',
  errorGeneric: 'Something went wrong. Please try again, or email us directly.',
  emailFallback: 'Prefer email? Write to',
} as const

type Category = keyof typeof TEXT.categories

const submitContactRequest = httpsCallable<Record<string, string>, { ok: true }>(functions, 'submitContactRequest')

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', organisation: '', category: 'school_enquiry' as Category, message: '', website: '' })
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')
  const contactEmail = useLegal()('contactEmail')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const messageLength = form.message.trim().length
  const canSend = state !== 'sending' && form.name.trim() && form.email.trim() && messageLength >= 10 && messageLength <= 4000

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSend) return
    setState('sending')
    setError('')
    try {
      await submitContactRequest(form)
      setState('sent')
    } catch (err: any) {
      const code = String(err?.code ?? '')
      setError(code.endsWith('resource-exhausted') ? TEXT.errorLimit
        : code.endsWith('invalid-argument') && err?.message ? err.message
        : TEXT.errorGeneric)
      setState('error')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 overflow-y-auto flex items-start sm:items-center justify-center px-4 py-8">
      <div className="relative w-full max-w-md">
        <div className="bg-zinc-900 rounded-3xl shadow-2xl p-8">
          <Link to="/login" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" /> {TEXT.back}
          </Link>

          <h1 className="text-2xl font-bold text-zinc-100">{TEXT.title}</h1>
          <p className="text-sm text-zinc-500 mt-1 mb-6">{TEXT.intro}</p>

          {state === 'sent' ? (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <h2 className="text-lg font-semibold text-zinc-100">{TEXT.successTitle}</h2>
              <p className="text-sm text-zinc-400">{TEXT.successBody}</p>
              <button
                type="button"
                onClick={() => { setForm(f => ({ ...f, message: '', website: '' })); setState('idle') }}
                className="text-sm text-brand-400 hover:text-brand-300"
              >
                {TEXT.sendAnother}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label className="label" htmlFor="contact-name">{TEXT.name}</label>
                <input id="contact-name" className="input" required maxLength={120} autoComplete="name"
                  value={form.name} onChange={set('name')} style={{ fontSize: 16 }} />
              </div>
              <div>
                <label className="label" htmlFor="contact-email">{TEXT.email}</label>
                <input id="contact-email" className="input" type="email" required maxLength={200} autoComplete="email"
                  value={form.email} onChange={set('email')} style={{ fontSize: 16 }} />
              </div>
              <div>
                <label className="label" htmlFor="contact-org">{TEXT.organisation}</label>
                <input id="contact-org" className="input" maxLength={200} autoComplete="organization"
                  value={form.organisation} onChange={set('organisation')} style={{ fontSize: 16 }} />
              </div>
              <div>
                <label className="label" htmlFor="contact-category">{TEXT.category}</label>
                <select id="contact-category" className="input" value={form.category} onChange={set('category')} style={{ fontSize: 16 }}>
                  {(Object.keys(TEXT.categories) as Category[]).map(c => <option key={c} value={c}>{TEXT.categories[c]}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="contact-message">{TEXT.message}</label>
                <textarea id="contact-message" className="input resize-y min-h-[140px]" required minLength={10} maxLength={4000}
                  value={form.message} onChange={set('message')} style={{ fontSize: 16 }} />
                <p className="text-xs text-zinc-500 mt-1 text-right">{TEXT.messageHint} · {messageLength}/4000</p>
              </div>

              {/* Honeypot: hidden from people and assistive tech; bots fill it in */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                <label htmlFor="contact-website">Website</label>
                <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
              </div>

              <p className="text-xs text-zinc-500">
                {TEXT.consentBefore}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">{TEXT.consentLink}</a>
                {TEXT.consentAfter}
              </p>

              {state === 'error' && (
                <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-800/50 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <p className="text-sm text-rose-400">{error}</p>
                </div>
              )}

              <button type="submit" disabled={!canSend} className="btn-primary w-full py-3 text-base disabled:opacity-50">
                {state === 'sending' ? TEXT.sending : TEXT.submit}
              </button>
            </form>
          )}

          {contactEmail && (
            <p className="text-xs text-zinc-500 text-center mt-6 flex items-center justify-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> {TEXT.emailFallback}{' '}
              <a href={`mailto:${contactEmail}`} className="text-brand-400 hover:underline">{contactEmail}</a>
            </p>
          )}
          <ProviderDetails className="text-center mt-4" />
        </div>
      </div>
    </div>
  )
}
