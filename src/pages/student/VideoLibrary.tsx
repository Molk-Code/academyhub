import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { useDropzone } from 'react-dropzone'
import { Video, Upload, CheckCircle2, Clock, AlertCircle, X, Loader2, Play } from 'lucide-react'
import { format } from 'date-fns'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useMicrosoftAuth } from '@/contexts/MicrosoftAuthContext'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import { uploadFile, getItemThumbnail } from '@/lib/graphApi'
import type { VideoDoc, SubjectDoc, CohortDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

interface UploadEntry {
  file: File
  subjectId: string
  pct: number
  error?: string
  done?: boolean
}

export default function StudentVideoLibrary() {
  const { profile, cohortId, roles } = useAuth()
  const { config, isConfigured, isMsSignedIn, signInWithMicrosoft, getAccessToken } = useMicrosoftAuth()

  const { data: subjects }  = useCollection<SubjectDoc>('subjects')
  const { data: cohortDoc } = useCollection<CohortDoc>('cohorts', cohortId ? [where('id', '==', cohortId)] : [], !!cohortId)
  const { data: myVideos, loading } = useCollection<VideoDoc>(
    'videos',
    profile ? [where('studentId', '==', profile.uid), orderBy('createdAt', 'desc')] : [],
    !!profile,
    profile?.uid ?? '',
  )

  const [selectedSubject, setSelectedSubject] = useState('')
  const [uploads,         setUploads]         = useState<UploadEntry[]>([])
  const [uploadSubject,   setUploadSubject]   = useState('')
  const [msError,         setMsError]         = useState<string | null>(null)

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))

  const onDrop = useCallback(async (files: File[]) => {
    if (!isConfigured || !config || !profile || !cohortId) return
    if (!isMsSignedIn) {
      setMsError('Sign in with Microsoft first.')
      return
    }
    if (!uploadSubject) {
      setMsError('Select a subject before uploading.')
      return
    }
    setMsError(null)

    const token = await getAccessToken()
    if (!token) return

    const folderPath = `${config.basePath}/Videos/${cohortId}/${uploadSubject}/${profile.uid}`
    const startIdx = uploads.length

    const newEntries: UploadEntry[] = files.map(f => ({ file: f, subjectId: uploadSubject, pct: 0 }))
    setUploads(prev => [...prev, ...newEntries])

    await Promise.allSettled(
      files.map(async (file, i) => {
        const idx = startIdx + i
        try {
          const item = await uploadFile(token, config.siteId, folderPath, file, pct => {
            setUploads(prev => prev.map((u, j) => j === idx ? { ...u, pct } : u))
          })

          // Get thumbnail (may not be ready immediately)
          const thumbnailUrl = await getItemThumbnail(token, config.siteId, item.id).catch(() => null)

          // Create Firestore video doc
          await addDoc(collection(db, 'videos'), {
            sharePointItemId: item.id,
            name:             file.name,
            uploaderId:       profile.uid,
            uploaderName:     profile.displayName,
            cohortId,
            subjectId:        uploadSubject,
            studentId:        profile.uid,
            durationSeconds:  null,
            fileSizeBytes:    file.size,
            mimeType:         file.type,
            thumbnailUrl,
            createdAt:        serverTimestamp(),
            reviewStatus:     'pending',
            grade:            null,
            gradedBy:         null,
            gradedAt:         null,
            feedback:         null,
          })

          setUploads(prev => prev.map((u, j) => j === idx ? { ...u, pct: 100, done: true } : u))
          // Auto-dismiss after 3s
          setTimeout(() => setUploads(prev => prev.filter((_, j) => j !== idx)), 3000)
        } catch (e: any) {
          setUploads(prev => prev.map((u, j) => j === idx ? { ...u, error: e.message } : u))
        }
      }),
    )
  }, [isConfigured, config, profile, cohortId, isMsSignedIn, uploadSubject, uploads.length, getAccessToken])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'video/*': [] },
    noClick: true,
    disabled: !isMsSignedIn || !uploadSubject,
  })

  const filtered = selectedSubject
    ? myVideos.filter(v => v.subjectId === selectedSubject)
    : myVideos

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-7">
      <div>
        <h1 className="page-title flex items-center gap-2"><Video className="w-6 h-6" /> My Videos</h1>
        <p className="text-zinc-500 text-sm mt-1">Upload and review your submitted videos.</p>
      </div>

      {/* Upload panel */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8">
          <h2 className="text-sm font-semibold text-zinc-200">Upload a video</h2>
        </div>
        <div className="p-5 space-y-4">
          {!isConfigured ? (
            <div className="text-sm text-zinc-500 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              SharePoint is not configured. Ask your admin to set it up.
            </div>
          ) : !isMsSignedIn ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-zinc-500">Connect your Microsoft account to upload.</p>
              <button
                onClick={() => signInWithMicrosoft().catch(e => setMsError(e.message))}
                className="btn-primary py-2 px-4 text-sm"
              >
                Sign in with Microsoft
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <label className="label text-xs mb-1 block">Subject</label>
                  <select
                    className="input w-48 text-sm"
                    value={uploadSubject}
                    onChange={e => setUploadSubject(e.target.value)}
                  >
                    <option value="">Choose subject…</option>
                    {subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                {...getRootProps()}
                className={cn(
                  'border-2 border-dashed rounded-2xl p-8 text-center transition-all',
                  isDragActive && uploadSubject
                    ? 'border-brand-400 bg-brand-50'
                    : !uploadSubject
                      ? 'border-white/10 bg-zinc-900/50 cursor-not-allowed'
                      : 'border-white/10 hover:border-brand-300 hover:bg-white/5 cursor-pointer',
                )}
                onClick={() => uploadSubject && open()}
              >
                <input {...getInputProps()} />
                <Upload className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
                <p className="text-sm text-zinc-500">
                  {!uploadSubject
                    ? 'Select a subject first'
                    : isDragActive
                      ? 'Drop videos here'
                      : 'Drag & drop videos or click to select'
                  }
                </p>
                <p className="text-xs text-zinc-400 mt-1">MP4, MOV, AVI, WebM supported</p>
              </div>
            </>
          )}

          {msError && (
            <div className="flex items-center gap-2 text-rose-600 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {msError}
            </div>
          )}

          {/* Upload progress */}
          {uploads.length > 0 && (
            <div className="space-y-2">
              {uploads.map((u, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Video className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-300 truncate mb-1">{u.file.name}</p>
                    {u.error ? (
                      <p className="text-xs text-rose-500">{u.error}</p>
                    ) : (
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', u.done ? 'bg-emerald-500' : 'bg-brand-500')}
                          style={{ width: `${u.pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400 flex-shrink-0 w-10 text-right">
                    {u.done ? '✓' : u.error ? '✗' : `${u.pct}%`}
                  </span>
                  {(u.done || u.error) && (
                    <button onClick={() => setUploads(prev => prev.filter((_, j) => j !== i))}>
                      <X className="w-3.5 h-3.5 text-zinc-400 hover:text-zinc-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-sm font-medium text-zinc-300">Filter:</p>
        <button
          onClick={() => setSelectedSubject('')}
          className={cn('px-3 py-1.5 rounded-xl text-sm font-medium border transition-all',
            !selectedSubject ? 'bg-brand-600 border-brand-600 text-white' : 'border-white/10 text-zinc-400 hover:border-white/15'
          )}
        >
          All
        </button>
        {subjects.map(s => (
          <button
            key={s.id}
            onClick={() => setSelectedSubject(selectedSubject === s.id ? '' : s.id)}
            className={cn('px-3 py-1.5 rounded-xl text-sm font-medium border transition-all',
              selectedSubject === s.id ? 'bg-brand-600 border-brand-600 text-white' : 'border-white/10 text-zinc-400 hover:border-white/15'
            )}
          >
            {s.iconEmoji} {s.title}
          </button>
        ))}
      </div>

      {/* Video grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <Video className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No videos yet. Upload your first video above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(video => {
            const subject = subjectMap[video.subjectId]
            return (
              <Link
                key={video.id}
                to={`/videos/${video.id}`}
                className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden hover:shadow-md hover:border-white/15 transition-all group"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video bg-slate-900 overflow-hidden">
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt={video.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video className="w-10 h-10 text-zinc-300" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 text-zinc-200 fill-current" />
                    </div>
                  </div>
                  {/* Status badge */}
                  <div className="absolute top-2 right-2">
                    {video.reviewStatus === 'reviewed' ? (
                      <span className="flex items-center gap-1 text-xs font-medium bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Reviewed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium bg-amber-500 text-white px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  <p className="font-semibold text-zinc-200 text-sm truncate mb-1">{video.name}</p>
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    {subject && (
                      <span className="flex items-center gap-1">
                        {subject.iconEmoji} {subject.title}
                      </span>
                    )}
                    {video.createdAt && (
                      <span>· {format(video.createdAt.toDate(), 'd MMM yyyy')}</span>
                    )}
                  </div>
                  {video.grade !== null && (
                    <p className="text-xs text-emerald-600 font-medium mt-1.5">Grade: {video.grade}/100</p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
