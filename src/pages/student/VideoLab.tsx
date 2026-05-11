import { useState, useRef, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { VideoLabDoc, SubjectDoc } from '@/types'
import { uploadVideo, thumbnailUrl } from '@/lib/cloudinary'
import { Play, Clock, Tag, Upload, X, Check, Loader2, Search } from 'lucide-react'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type UploadPhase = 'idle' | 'uploading' | 'metadata' | 'saving'

export default function VideoLab() {
  const { profile, role } = useAuth()
  const navigate = useNavigate()

  const { data: videos } = useCollection<VideoLabDoc>('video_lab', [orderBy('createdAt', 'desc')])
  const { data: subjects } = useCollection<SubjectDoc>('subjects')

  const [filterSubject,  setFilterSubject]  = useState('')
  const [filterTag,      setFilterTag]      = useState('')
  const [filterUploader, setFilterUploader] = useState('')
  const [search,         setSearch]         = useState('')

  // Upload modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadedPublicId, setUploadedPublicId] = useState('')
  const [uploadedDuration, setUploadedDuration] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const allTags = useMemo(() => {
    const set = new Set<string>()
    videos.forEach(v => (v.tags ?? []).forEach(t => set.add(t)))
    return Array.from(set).sort()
  }, [videos])

  const allUploaders = useMemo(() => {
    const map = new Map<string, string>()
    videos.forEach(v => map.set(v.uploaderId, v.uploaderName))
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [videos])

  const filtered = useMemo(() => videos.filter(v => {
    if (filterSubject  && v.subjectId  !== filterSubject)  return false
    if (filterTag      && !(v.tags ?? []).includes(filterTag)) return false
    if (filterUploader && v.uploaderId !== filterUploader) return false
    if (search) {
      const q = search.toLowerCase()
      if (!v.title.toLowerCase().includes(q) && !v.uploaderName.toLowerCase().includes(q) && !(v.description ?? '').toLowerCase().includes(q)) return false
    }
    return true
  }), [videos, filterSubject, filterTag, filterUploader, search])

  function openModal() {
    setModalOpen(true)
    setUploadPhase('idle')
    setUploadProgress(0)
    setUploadedPublicId('')
    setTitle('')
    setDescription('')
    setSubjectId('')
    setTagsInput('')
    setUploadError('')
    setDragging(false)
  }

  function closeModal() {
    if (uploadPhase === 'uploading' || uploadPhase === 'saving') return
    setModalOpen(false)
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('video/')) { setUploadError('Please select a video file.'); return }
    setUploadError('')
    setUploadPhase('uploading')
    setUploadProgress(0)
    try {
      const result = await uploadVideo(file, pct => setUploadProgress(pct))
      setUploadedPublicId(result.publicId)
      setUploadedDuration(result.duration)
      setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))
      setUploadPhase('metadata')
    } catch (e: any) {
      setUploadError(e.message ?? 'Upload failed')
      setUploadPhase('idle')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function saveVideo() {
    if (!profile || !uploadedPublicId) return
    if (!title.trim()) { setUploadError('Title is required'); return }
    setUploadPhase('saving')
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)
    try {
      const ref = await addDoc(collection(db, 'video_lab'), {
        cloudinaryPublicId: uploadedPublicId,
        title: title.trim(),
        description: description.trim(),
        subjectId: subjectId || null,
        uploaderId: profile.uid,
        uploaderName: profile.displayName ?? 'Unknown',
        duration: uploadedDuration,
        tags,
        createdAt: serverTimestamp(),
      })
      setModalOpen(false)
      // Navigate to the player based on current layout
      const basePath = role === 'teacher' || role === 'admin' ? '/teacher/video-lab' : '/video-lab'
      navigate(`${basePath}/${ref.id}`)
    } catch (e: any) {
      setUploadError(e.message ?? 'Save failed')
      setUploadPhase('metadata')
    }
  }

  async function deleteVideo(videoId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Delete this video?')) return
    await deleteDoc(doc(db, 'video_lab', videoId))
  }

  const canDeleteAny = role === 'teacher' || role === 'admin'
  const playerBase = role === 'teacher' || role === 'admin' ? '/teacher/video-lab' : '/video-lab'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="page-title">Video Lab</h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">Beta</span>
          </div>
          <p className="text-zinc-500 text-sm mt-1">Watch videos and leave timestamped comments.</p>
        </div>
        <button
          onClick={openModal}
          className="btn-primary gap-2 flex-shrink-0"
        >
          <Upload className="w-4 h-4" /> Upload Video
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="input pl-8 py-1.5 text-sm w-40"
          />
        </div>
        <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} className="input py-1.5 text-sm w-44">
          <option value="">All subjects</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>)}
        </select>
        {allTags.length > 0 && (
          <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="input py-1.5 text-sm w-40">
            <option value="">All tags</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {(canDeleteAny && allUploaders.length > 1) && (
          <select value={filterUploader} onChange={e => setFilterUploader(e.target.value)} className="input py-1.5 text-sm w-44">
            <option value="">All uploaders</option>
            {allUploaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        {(filterSubject || filterTag || filterUploader || search) && (
          <button onClick={() => { setFilterSubject(''); setFilterTag(''); setFilterUploader(''); setSearch('') }} className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors">
            Clear filters
          </button>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-6xl mb-4">🎬</div>
          <p className="text-zinc-500 font-medium">No videos yet</p>
          <p className="text-zinc-400 text-sm mt-1">Upload the first one!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(video => {
            const subj = subjects.find(s => s.id === video.subjectId)
            const canDelete = canDeleteAny || video.uploaderId === profile?.uid
            return (
              <Link
                key={video.id}
                to={`${playerBase}/${video.id}`}
                className="group bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden shadow-sm hover:shadow-card-hover hover:-translate-y-0.5 transition-all relative"
              >
                <div className="relative aspect-video bg-slate-900 overflow-hidden">
                  <img
                    src={thumbnailUrl(video.cloudinaryPublicId)}
                    alt={video.title}
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 text-zinc-100 ml-0.5" />
                    </div>
                  </div>
                  {video.duration > 0 && (
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-mono px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Clock className="w-3 h-3" />{formatDuration(video.duration)}
                    </div>
                  )}
                  {canDelete && (
                    <button
                      onClick={e => deleteVideo(video.id, e)}
                      className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-rose-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="p-4">
                  <p className="font-semibold text-zinc-100 text-sm leading-tight line-clamp-2">{video.title}</p>
                  {video.description && (
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{video.description}</p>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-zinc-400">{video.uploaderName}</span>
                    {subj && <span className="text-xs text-zinc-400">{subj.iconEmoji} {subj.title}</span>}
                  </div>
                  {(video.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {video.tags.map(t => (
                        <span key={t} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-amber-950/40 text-amber-300 border border-amber-800/50">
                          <Tag className="w-2.5 h-2.5" />{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Upload Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            className="bg-zinc-900 rounded-2xl w-full max-w-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
              <h2 className="font-semibold text-zinc-100">Upload Video</h2>
              <button
                onClick={closeModal}
                disabled={uploadPhase === 'uploading' || uploadPhase === 'saving'}
                className="p-1.5 text-zinc-400 hover:text-zinc-300 disabled:opacity-30 transition-colors rounded-lg hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Phase: idle — drag-drop */}
              {uploadPhase === 'idle' && (
                <>
                  {uploadError && <p className="text-sm text-rose-500 font-medium">{uploadError}</p>}
                  <div
                    onDragOver={e => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all select-none ${
                      dragging ? 'border-amber-400 bg-amber-50' : 'border-white/15 hover:border-amber-400 hover:bg-amber-950/30'
                    }`}
                  >
                    <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
                    <div className="text-4xl mb-3">🎬</div>
                    <p className="font-medium text-zinc-300">Drag & drop or click to select</p>
                    <p className="text-xs text-zinc-400 mt-1">MP4, MOV, AVI, MKV</p>
                  </div>
                </>
              )}

              {/* Phase: uploading */}
              {uploadPhase === 'uploading' && (
                <div className="space-y-3 py-2">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-amber-500 animate-spin flex-shrink-0" />
                    <p className="font-medium text-zinc-200">Uploading… {uploadProgress}%</p>
                  </div>
                  <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-200" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-xs text-zinc-400">Don't close this window.</p>
                </div>
              )}

              {/* Phase: metadata / saving */}
              {(uploadPhase === 'metadata' || uploadPhase === 'saving') && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-emerald-600 text-sm font-medium">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" /> Upload complete — add details
                  </div>
                  {uploadError && <p className="text-sm text-rose-500">{uploadError}</p>}
                  <div>
                    <label className="label text-xs">Title *</label>
                    <input value={title} onChange={e => setTitle(e.target.value)} className="input w-full" placeholder="Video title…" />
                  </div>
                  <div>
                    <label className="label text-xs">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="input w-full resize-none" placeholder="What's this video about?" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label text-xs">Subject</label>
                      <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className="input w-full">
                        <option value="">No subject</option>
                        {subjects.map(s => <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs">Tags <span className="text-zinc-400 font-normal">(comma-sep)</span></label>
                      <input value={tagsInput} onChange={e => setTagsInput(e.target.value)} className="input w-full" placeholder="editing, short film" />
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={saveVideo} disabled={uploadPhase === 'saving' || !title.trim()} className="btn-primary gap-2 flex-1">
                      {uploadPhase === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save & View
                    </button>
                    <button onClick={closeModal} className="btn-secondary">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
