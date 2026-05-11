import { useState, useEffect, useCallback, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { format } from 'date-fns'
import {
  FolderPlus, Upload, RefreshCw, Trash2, Download, ChevronRight,
  LogIn, Settings, AlertCircle, Loader2, X, ExternalLink,
} from 'lucide-react'
import { useMicrosoftAuth } from '@/contexts/MicrosoftAuthContext'
import {
  listChildren, uploadFile, createFolder, deleteItem,
  fileIcon, formatBytes, type DriveItem,
} from '@/lib/graphApi'
import { cn } from '@/lib/utils'

interface Props {
  subPath: string      // relative to config.basePath, e.g. "subjects/abc123"
  canDelete?: boolean
  canUpload?: boolean
  title?: string
}

interface UploadEntry {
  name: string
  pct: number
  error?: string
}

export default function SharePointBrowser({ subPath, canDelete = false, canUpload = true, title }: Props) {
  const { config, configLoading, isConfigured, isMsSignedIn, signInWithMicrosoft, getAccessToken } = useMicrosoftAuth()

  const [items,        setItems]        = useState<DriveItem[]>([])
  const [crumbs,       setCrumbs]       = useState<string[]>([]) // extra path segments beyond subPath
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [uploads,      setUploads]      = useState<UploadEntry[]>([])
  const [newFolderMode, setNewFolderMode] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const currentPath = [config?.basePath ?? '', subPath, ...crumbs].filter(Boolean).join('/')

  const load = useCallback(async () => {
    if (!isConfigured || !isMsSignedIn || !config) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) { setError('Not signed in to Microsoft'); return }

      // Ensure folder exists by trying to list; if 404, create it
      let children: DriveItem[] = []
      try {
        children = await listChildren(token, config.siteId, currentPath)
      } catch (err: any) {
        if (err.message?.includes('404') || err.message?.toLowerCase().includes('not found')) {
          // Auto-create the folder path
          await ensureFolderPath(token, config.siteId, config.basePath ?? '', [subPath, ...crumbs])
          children = await listChildren(token, config.siteId, currentPath)
        } else {
          throw err
        }
      }

      // Sort: folders first, then files alphabetically
      children.sort((a, b) => {
        if (a.folder && !b.folder) return -1
        if (!a.folder && b.folder) return 1
        return a.name.localeCompare(b.name)
      })
      setItems(children)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [isConfigured, isMsSignedIn, config, currentPath, getAccessToken, subPath, crumbs])

  useEffect(() => {
    if (isConfigured && isMsSignedIn) load()
  }, [load])

  async function ensureFolderPath(token: string, siteId: string, base: string, segments: string[]) {
    let path = base
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg
      try {
        await listChildren(token, siteId, path)
      } catch {
        const parts = path.split('/')
        const parent = parts.slice(0, -1).join('/')
        const name = parts[parts.length - 1]
        await createFolder(token, siteId, parent || '/', name)
      }
    }
  }

  const onDrop = useCallback(async (files: File[]) => {
    if (!isConfigured || !config || files.length === 0) return
    const token = await getAccessToken()
    if (!token) { setError('Not signed in to Microsoft'); return }

    const newUploads = files.map(f => ({ name: f.name, pct: 0 }))
    setUploads(prev => [...prev, ...newUploads])

    await Promise.allSettled(
      files.map(async (file, i) => {
        const idx = uploads.length + i
        try {
          await uploadFile(token, config.siteId, currentPath, file, pct => {
            setUploads(prev => prev.map((u, j) => j === idx ? { ...u, pct } : u))
          })
          setUploads(prev => prev.filter((_, j) => j !== idx))
        } catch (err: any) {
          setUploads(prev => prev.map((u, j) => j === idx ? { ...u, error: err.message } : u))
        }
      }),
    )
    load()
  }, [isConfigured, config, currentPath, getAccessToken, load, uploads.length])

  const { getRootProps, getInputProps, isDragActive, open: openFilePicker } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    disabled: !canUpload || !isMsSignedIn,
  })

  async function handleCreateFolder() {
    if (!newFolderName.trim() || !config) return
    setCreatingFolder(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      await createFolder(token, config.siteId, currentPath, newFolderName.trim())
      setNewFolderName('')
      setNewFolderMode(false)
      load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreatingFolder(false)
    }
  }

  async function handleDelete(item: DriveItem) {
    if (!config || !confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    setDeleting(item.id)
    try {
      const token = await getAccessToken()
      if (!token) return
      await deleteItem(token, config.siteId, item.id)
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setDeleting(null)
    }
  }

  function navigateInto(folder: DriveItem) {
    setCrumbs(prev => [...prev, folder.name])
    setItems([])
  }

  function navigateTo(idx: number) {
    setCrumbs(prev => prev.slice(0, idx))
    setItems([])
  }

  // ── Render states ─────────────────────────────────────────────────────────────

  if (configLoading) return null

  if (!isConfigured) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-6 flex items-center gap-3 text-zinc-500 text-sm">
        <Settings className="w-5 h-5 flex-shrink-0 text-zinc-400" />
        <div>
          <p className="font-medium text-zinc-300">SharePoint not configured</p>
          <p className="text-xs text-zinc-400 mt-0.5">An admin must configure the SharePoint connection under Admin → SharePoint.</p>
        </div>
      </div>
    )
  }

  if (!isMsSignedIn) {
    return (
      <div className="rounded-2xl border border-blue-800/50 bg-blue-950/40 p-6 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
          <LogIn className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <p className="font-semibold text-zinc-200">Sign in with Microsoft</p>
          <p className="text-xs text-zinc-500 mt-1">Connect your school Microsoft account to access SharePoint files.</p>
        </div>
        <button
          onClick={() => signInWithMicrosoft().catch(e => setError(e.message))}
          className="btn-primary py-2 px-5 text-sm"
        >
          Sign in with Microsoft 365
        </button>
        {error && <p className="text-xs text-rose-500">{error}</p>}
      </div>
    )
  }

  const crumbParts = [subPath.split('/').pop() ?? 'Files', ...crumbs]

  return (
    <div
      {...getRootProps()}
      className={cn(
        'rounded-2xl border border-white/10 bg-zinc-900 overflow-hidden transition-all',
        isDragActive && 'ring-2 ring-brand-400 border-brand-300',
      )}
    >
      <input {...getInputProps()} />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8 bg-zinc-900/50 flex-wrap">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm font-medium">
          {crumbs.length > 0 && (
            <button
              onClick={() => navigateTo(0)}
              className="text-brand-600 hover:text-brand-800 truncate max-w-[120px]"
            >
              {crumbParts[0]}
            </button>
          )}
          {crumbs.map((seg, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
              {idx < crumbs.length - 1 ? (
                <button
                  onClick={() => navigateTo(idx + 1)}
                  className="text-brand-600 hover:text-brand-800 truncate max-w-[120px]"
                >
                  {seg}
                </button>
              ) : (
                <span className="text-zinc-200 truncate max-w-[120px]">{seg}</span>
              )}
            </span>
          ))}
          {crumbs.length === 0 && (
            <span className="text-zinc-200">{crumbParts[0]}</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {canUpload && (
            <>
              <button
                onClick={openFilePicker}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload
              </button>
              <button
                onClick={() => { setNewFolderMode(true); setTimeout(() => folderInputRef.current?.focus(), 50) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-zinc-400 hover:bg-zinc-800 transition-colors"
                title="New folder"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            onClick={load}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Drag overlay hint */}
      {isDragActive && (
        <div className="absolute inset-0 bg-brand-50/80 flex items-center justify-center z-10 pointer-events-none rounded-2xl">
          <div className="flex flex-col items-center gap-2 text-brand-600">
            <Upload className="w-8 h-8" />
            <p className="font-semibold text-sm">Drop to upload</p>
          </div>
        </div>
      )}

      {/* New folder input */}
      {newFolderMode && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/8 bg-zinc-900/50">
          <FolderPlus className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          <input
            ref={folderInputRef}
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateFolder()
              if (e.key === 'Escape') { setNewFolderMode(false); setNewFolderName('') }
            }}
            placeholder="Folder name…"
            className="flex-1 text-sm bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1 outline-none focus:border-brand-400"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || creatingFolder}
            className="px-3 py-1 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-40 transition-colors"
          >
            {creatingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
          </button>
          <button
            onClick={() => { setNewFolderMode(false); setNewFolderName('') }}
            className="p-1 rounded text-zinc-400 hover:text-zinc-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="px-4 py-2 border-b border-white/8 space-y-1.5">
          {uploads.map((u, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 text-xs text-zinc-400 mb-0.5">
                <Upload className="w-3 h-3 flex-shrink-0" />
                <span className="flex-1 truncate">{u.name}</span>
                {u.error
                  ? <span className="text-rose-500">Failed</span>
                  : <span>{u.pct}%</span>
                }
                {u.error && (
                  <button onClick={() => setUploads(p => p.filter((_, j) => j !== i))}>
                    <X className="w-3 h-3 text-zinc-400" />
                  </button>
                )}
              </div>
              {!u.error && (
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${u.pct}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-950/40 border-b border-rose-800/50 text-rose-400 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="p-0.5 hover:text-rose-800"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* File list */}
      <div className="divide-y divide-slate-50">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-12 gap-2 text-zinc-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading files…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-400 text-sm">
            <span className="text-3xl">📂</span>
            <p>No files yet</p>
            {canUpload && (
              <button onClick={openFilePicker} className="text-brand-600 hover:text-brand-700 text-xs font-medium">
                Upload the first file
              </button>
            )}
          </div>
        ) : (
          items.map(item => (
            <div
              key={item.id}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 hover:bg-white/5/80 transition-colors group',
                item.folder && 'cursor-pointer',
              )}
              onClick={() => item.folder && navigateInto(item)}
            >
              <span className="text-xl flex-shrink-0 select-none">{fileIcon(item)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">{item.name}</p>
                <p className="text-[11px] text-zinc-400">
                  {item.folder
                    ? `${item.folder.childCount ?? 0} items`
                    : formatBytes(item.size)
                  }
                  {item.lastModifiedDateTime && (
                    <> · {format(new Date(item.lastModifiedDateTime), 'd MMM yyyy')}</>
                  )}
                </p>
              </div>

              <div
                className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={e => e.stopPropagation()}
              >
                {!item.folder && item['@microsoft.graph.downloadUrl'] && (
                  <a
                    href={item['@microsoft.graph.downloadUrl']}
                    target="_blank"
                    rel="noreferrer"
                    download={item.name}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-600 hover:bg-zinc-800 transition-colors"
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                )}
                {item.webUrl && (
                  <a
                    href={item.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-600 hover:bg-zinc-800 transition-colors"
                    title="Open in SharePoint"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {canDelete && (
                  <button
                    onClick={() => handleDelete(item)}
                    disabled={deleting === item.id}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-40"
                    title="Delete"
                  >
                    {deleting === item.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
