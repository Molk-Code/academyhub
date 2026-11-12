import { useMemo, useState } from 'react'
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { useDocument } from '@/hooks/useFirestore'
import { parseInviteCsv, inviteLinksCsv, type InviteRole, type InviteRow } from '@/lib/inviteCsv'
import { FileSpreadsheet, ChevronDown, ChevronUp, Loader2, Download, Check, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// Invite a whole class from a spreadsheet: choose the file, check the
// preview (who is invited, who is skipped and why), then create the invites
// and optionally email them. The links can be downloaded as a CSV.

interface Props {
  cohorts: { id: string; name: string }[]   // current classes
  existingEmails: Set<string>
  pendingEmails: Set<string>
}

interface Created { email: string; displayName: string; cohortName: string | null; url: string; emailed: boolean; error?: string }

const sendInvite = httpsCallable<
  { email: string; role: InviteRole; cohortId: string | null; appUrl: string; displayName: string; expiresInDays: number },
  { inviteId: string; inviteUrl: string; emailSent: boolean }
>(functions, 'sendInviteEmail')

const STATUS_STYLE: Record<InviteRow['status'], string> = {
  ok: 'text-emerald-400', skip: 'text-zinc-500', error: 'text-rose-400',
}

export default function CsvInvite({ cohorts, existingEmails, pendingEmails }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [defaultRole, setDefaultRole] = useState<InviteRole>('student')
  const [defaultCohortId, setDefaultCohortId] = useState('')
  const [days, setDays] = useState(14)
  const [emailThem, setEmailThem] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [created, setCreated] = useState<Created[] | null>(null)
  const { data: emailCfg } = useDocument<{ id: string; fromEmail?: string }>('email_config', 'global')
  const canEmail = !!emailCfg?.fromEmail && emailCfg.fromEmail !== 'onboarding@resend.dev'

  const rows = useMemo(() => text.trim()
    ? parseInviteCsv(text, { cohorts, defaultRole, defaultCohortId: defaultCohortId || null, existingEmails, pendingEmails })
    : [], [text, cohorts, defaultRole, defaultCohortId, existingEmails, pendingEmails])
  const ok = rows.filter(r => r.status === 'ok')
  const errors = rows.filter(r => r.status === 'error')
  const skipped = rows.filter(r => r.status === 'skip')

  async function pickFile(f: File | undefined) {
    if (!f) return
    setCreated(null)
    setFileName(f.name)
    setText(await f.text())
  }

  async function createOne(r: InviteRow): Promise<Created> {
    const base = { email: r.email, displayName: r.displayName, cohortName: r.cohortName }
    try {
      if (emailThem && canEmail) {
        const { data } = await sendInvite({
          email: r.email, role: r.role, cohortId: r.cohortId, appUrl: window.location.origin,
          displayName: r.displayName, expiresInDays: days,
        })
        return { ...base, url: data.inviteUrl, emailed: data.emailSent }
      }
      const ref = await addDoc(collection(db, 'invitations'), {
        email: r.email,
        ...(r.displayName ? { displayName: r.displayName } : {}),
        role: r.role,
        cohortId: r.cohortId,
        used: false,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + days * 86_400_000)),
      })
      return { ...base, url: `${window.location.origin}/accept-invite?token=${ref.id}`, emailed: false }
    } catch (e: any) {
      return { ...base, url: '', emailed: false, error: e?.message ?? 'Failed' }
    }
  }

  async function createAll() {
    setBusy(true); setProgress(0)
    const out: Created[] = []
    // A few at a time: fast, without flooding the mail provider
    for (let i = 0; i < ok.length; i += 4) {
      out.push(...await Promise.all(ok.slice(i, i + 4).map(createOne)))
      setProgress(out.length)
    }
    setCreated(out)
    setBusy(false)
    setText(''); setFileName('')
  }

  function download() {
    const csv = inviteLinksCsv((created ?? []).filter(c => c.url))
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'invite-links.csv'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const failed = created?.filter(c => c.error) ?? []

  return (
    <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/5 transition-colors"
      >
        <h2 className="text-base font-semibold text-zinc-200 flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-brand-500" /> Invite from a file
          <span className="text-xs font-normal text-zinc-500">— a class list as CSV, with names and classes</span>
        </h2>
        {open ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-4 border-t border-white/10 pt-5">
          <p className="text-xs text-zinc-500">
            Save the class list from Excel or the school system as CSV. Columns can be in any order:
            <b> email</b> (required), <b>name</b> or <b>first name</b> + <b>last name</b>, <b>role</b> (student/teacher)
            and <b>class</b> — English or Swedish headings (e-post, förnamn, efternamn, roll, klass) both work.
          </p>

          <div className="flex flex-wrap gap-4 items-end">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="csv-file" className="label">CSV file</label>
              <input
                id="csv-file" type="file" accept=".csv,.txt,text/csv"
                onChange={e => { pickFile(e.target.files?.[0]); e.target.value = '' }}
                className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-zinc-100 hover:file:bg-white/15"
              />
              {fileName && <p className="text-xs text-zinc-500 mt-1">{fileName}</p>}
            </div>
            <div className="min-w-[130px]">
              <label htmlFor="csv-role" className="label">Role if not in file</label>
              <select id="csv-role" value={defaultRole} onChange={e => setDefaultRole(e.target.value as InviteRole)} className="input w-full">
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>
            <div className="min-w-[160px]">
              <label htmlFor="csv-class" className="label">Class if not in file</label>
              <select id="csv-class" value={defaultCohortId} onChange={e => setDefaultCohortId(e.target.value)} className="input w-full">
                <option value="">Assign later…</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="min-w-[120px]">
              <label htmlFor="csv-days" className="label">Links valid for</label>
              <select id="csv-days" value={days} onChange={e => setDays(Number(e.target.value))} className="input w-full">
                {[7, 14, 30, 60].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
          </div>

          <label className={cn('flex items-center gap-2 text-sm', canEmail ? 'text-zinc-300' : 'text-zinc-500')}>
            <input type="checkbox" checked={emailThem && canEmail} disabled={!canEmail} onChange={e => setEmailThem(e.target.checked)} />
            Email each person their invite
            {!canEmail && <span className="text-xs">(set up a sender under Email settings first — you can still download the links)</span>}
          </label>

          {rows.length > 0 && (
            <div className="space-y-3" aria-live="polite">
              <p className="text-sm text-zinc-300">
                <b className="text-emerald-400">{ok.length}</b> to invite
                {skipped.length > 0 && <> · <b className="text-zinc-400">{skipped.length}</b> skipped</>}
                {errors.length > 0 && <> · <b className="text-rose-400">{errors.length}</b> with problems (fix the file and choose it again)</>}
              </p>
              <div className="max-h-72 overflow-auto rounded-xl border border-white/10">
                <table className="w-full text-xs">
                  <thead className="bg-white/5 text-zinc-400 sticky top-0">
                    <tr>
                      <th scope="col" className="text-left font-medium px-3 py-2">Line</th>
                      <th scope="col" className="text-left font-medium px-3 py-2">Name</th>
                      <th scope="col" className="text-left font-medium px-3 py-2">Email</th>
                      <th scope="col" className="text-left font-medium px-3 py-2">Role</th>
                      <th scope="col" className="text-left font-medium px-3 py-2">Class</th>
                      <th scope="col" className="text-left font-medium px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {rows.map(r => (
                      <tr key={r.line} className={r.status === 'ok' ? '' : 'opacity-80'}>
                        <td className="px-3 py-1.5 text-zinc-500">{r.line}</td>
                        <td className="px-3 py-1.5 text-zinc-200">{r.displayName || '—'}</td>
                        <td className="px-3 py-1.5 text-zinc-300">{r.email || '—'}</td>
                        <td className="px-3 py-1.5 text-zinc-400">{r.role}</td>
                        <td className="px-3 py-1.5 text-zinc-400">{r.cohortName ?? '—'}</td>
                        <td className={cn('px-3 py-1.5', STATUS_STYLE[r.status])}>
                          {r.status === 'ok' ? (r.note ? <span className="text-amber-300">{r.note}</span> : 'Will be invited') : r.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={createAll} disabled={busy || ok.length === 0} className="btn-primary py-2 px-5 disabled:opacity-50">
                {busy
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Inviting {progress} of {ok.length}…</>
                  : <>Invite {ok.length} {ok.length === 1 ? 'person' : 'people'}{emailThem && canEmail ? ' and email them' : ''}</>}
              </button>
            </div>
          )}

          {created && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2" aria-live="polite">
              <p className="text-sm text-emerald-300 flex items-center gap-2">
                <Check className="w-4 h-4" aria-hidden="true" />
                {created.length - failed.length} invites created{created.some(c => c.emailed) && `, ${created.filter(c => c.emailed).length} emailed`}.
              </p>
              {failed.length > 0 && (
                <div className="text-xs text-rose-300 space-y-0.5">
                  <p className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> {failed.length} failed:</p>
                  {failed.map(f => <p key={f.email}>{f.email}: {f.error}</p>)}
                </div>
              )}
              <button onClick={download} className="btn-secondary py-1.5 text-xs">
                <Download className="w-3.5 h-3.5" /> Download the links (CSV)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
