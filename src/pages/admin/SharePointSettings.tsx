import { useState, useEffect } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useDocument } from '@/hooks/useFirestore'
import { useMicrosoftAuth, type SharePointConfigDoc } from '@/contexts/MicrosoftAuthContext'
import { resolveSiteId } from '@/lib/graphApi'
import { Check, Loader2, AlertCircle, ExternalLink, LogIn, LogOut } from 'lucide-react'

export default function SharePointSettings() {
  const { data: saved, loading } = useDocument<SharePointConfigDoc>('settings', 'sharepoint')
  const { isMsSignedIn, msAccount, signInWithMicrosoft, signOutMicrosoft, getAccessToken } = useMicrosoftAuth()

  const [tenantId,   setTenantId]   = useState('')
  const [clientId,   setClientId]   = useState('')
  const [siteUrl,    setSiteUrl]    = useState('')
  const [basePath,   setBasePath]   = useState('CineForge')
  const [saving,     setSaving]     = useState(false)
  const [saved_ok,   setSavedOk]    = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; siteId?: string; msg: string } | null>(null)
  const [error,      setError]      = useState<string | null>(null)

  useEffect(() => {
    if (saved) {
      setTenantId(saved.tenantId ?? '')
      setClientId(saved.clientId ?? '')
      setSiteUrl(saved.siteUrl ?? '')
      setBasePath(saved.basePath ?? 'CineForge')
    }
  }, [saved])

  async function handleSave() {
    if (!tenantId.trim() || !clientId.trim()) {
      setError('Tenant ID and Client ID are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const siteId = testResult?.siteId ?? saved?.siteId ?? ''
      await setDoc(doc(db, 'settings', 'sharepoint'), {
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        siteUrl:  siteUrl.trim(),
        siteId,
        basePath: basePath.trim() || 'CineForge',
      }, { merge: true })
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2500)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!siteUrl.trim()) { setError('Enter a SharePoint site URL first.'); return }
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      // Sign in if needed
      if (!isMsSignedIn) await signInWithMicrosoft()
      const token = await getAccessToken()
      if (!token) throw new Error('Could not obtain access token')

      const siteId = await resolveSiteId(token, siteUrl.trim())
      setTestResult({ ok: true, siteId, msg: `Connected! Site ID: ${siteId}` })

      // Auto-save the siteId
      if (tenantId.trim() && clientId.trim()) {
        await setDoc(doc(db, 'settings', 'sharepoint'), {
          tenantId: tenantId.trim(),
          clientId: clientId.trim(),
          siteUrl:  siteUrl.trim(),
          siteId,
          basePath: basePath.trim() || 'CineForge',
        }, { merge: true })
        setSavedOk(true)
        setTimeout(() => setSavedOk(false), 2500)
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message ?? 'Connection failed' })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">SharePoint Integration</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Connect to Microsoft SharePoint for file storage. Files are stored in your school's SharePoint library.
        </p>
      </div>

      {/* Setup guide */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 space-y-2">
        <p className="text-sm font-semibold text-blue-800">Setup guide</p>
        <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
          <li>In <a href="https://portal.azure.com" target="_blank" rel="noreferrer" className="underline">Azure Portal</a> → App registrations → New registration</li>
          <li>Set redirect URI: <code className="bg-blue-100 px-1 rounded">{window.location.origin}</code> (type: Single-page application)</li>
          <li>Under API permissions → Add → Microsoft Graph → Delegated → <code className="bg-blue-100 px-1 rounded">Files.ReadWrite.All</code> and <code className="bg-blue-100 px-1 rounded">Sites.ReadWrite.All</code></li>
          <li>Grant admin consent for your directory</li>
          <li>Copy the Application (client) ID and Directory (tenant) ID below</li>
        </ol>
        <a
          href="https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app"
          target="_blank" rel="noreferrer"
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          Full documentation <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Microsoft sign-in status */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5">
        <p className="text-sm font-semibold text-zinc-200 mb-3">Microsoft Account</p>
        {isMsSignedIn ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
              M
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-200">{msAccount?.name ?? msAccount?.username}</p>
              <p className="text-xs text-zinc-400">{msAccount?.username}</p>
            </div>
            <button
              onClick={() => signOutMicrosoft().catch(e => setError(e.message))}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 border border-white/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-zinc-500 flex-1">Sign in to test the connection and resolve the site ID.</p>
            <button
              onClick={() => signInWithMicrosoft().catch(e => setError(e.message))}
              className="flex items-center gap-1.5 text-sm font-medium text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg transition-colors"
            >
              <LogIn className="w-4 h-4" /> Sign in with Microsoft
            </button>
          </div>
        )}
      </div>

      {/* Config form */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 space-y-5">
        <p className="text-sm font-semibold text-zinc-200">Azure App Configuration</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Directory (Tenant) ID</label>
            <input
              className="input font-mono text-xs"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={tenantId}
              onChange={e => setTenantId(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Application (Client) ID</label>
            <input
              className="input font-mono text-xs"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
            />
          </div>
          <div>
            <label className="label">SharePoint Site URL</label>
            <input
              className="input"
              placeholder="https://school.sharepoint.com/sites/cineforge"
              value={siteUrl}
              onChange={e => setSiteUrl(e.target.value)}
            />
            <p className="text-[11px] text-zinc-400 mt-1">The URL of the SharePoint site where files will be stored.</p>
          </div>
          <div>
            <label className="label">Base folder name</label>
            <input
              className="input"
              placeholder="CineForge"
              value={basePath}
              onChange={e => setBasePath(e.target.value)}
            />
            <p className="text-[11px] text-zinc-400 mt-1">Root folder inside the SharePoint document library.</p>
          </div>
        </div>

        {saved?.siteId && (
          <div className="bg-zinc-900/50 rounded-xl px-4 py-3">
            <p className="text-xs text-zinc-500">
              <span className="font-medium">Resolved Site ID:</span>{' '}
              <code className="font-mono text-xs text-zinc-300">{saved.siteId}</code>
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-rose-600 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {testResult && (
          <div className={`flex items-start gap-2 text-sm rounded-xl px-4 py-3 ${testResult.ok ? 'bg-emerald-950/40 text-emerald-300' : 'bg-rose-950/40 text-rose-400'}`}>
            {testResult.ok
              ? <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
              : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            }
            <span>{testResult.msg}</span>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleTest}
            disabled={testing || !siteUrl.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-white/10 text-zinc-300 hover:bg-white/5 disabled:opacity-40 transition-colors"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {testing ? 'Testing…' : 'Test connection & resolve Site ID'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !tenantId.trim() || !clientId.trim()}
            className="btn-primary py-2 px-4 flex items-center gap-2 disabled:opacity-40"
          >
            {saving
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : saved_ok
                ? <Check className="w-4 h-4" />
                : null
            }
            {saving ? 'Saving…' : saved_ok ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
