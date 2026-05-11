import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import {
  collection, addDoc, deleteDoc, doc, serverTimestamp,
  onSnapshot, query, orderBy, updateDoc,
} from 'firebase/firestore'
import { MediaPlayer, MediaProvider, useMediaState, useMediaRemote } from '@vidstack/react'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  ArrowLeft, Send, Trash2, ChevronDown, CheckCircle2, Star,
} from 'lucide-react'
import { format } from 'date-fns'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useMicrosoftAuth } from '@/contexts/MicrosoftAuthContext'
import { useDocument } from '@/hooks/useFirestore'
import { getItemDetails } from '@/lib/graphApi'
import type { VideoDoc, VideoCommentDoc } from '@/types'
import Avatar from '@/components/common/Avatar'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

// ── Custom controls (inside MediaPlayer scope so hooks work) ──────────────────

function VideoControls({
  duration,
  comments,
  onSeek,
}: {
  duration: number
  comments: VideoCommentDoc[]
  onSeek: (t: number) => void
}) {
  const currentTime = useMediaState('currentTime')
  const paused      = useMediaState('paused')
  const volume      = useMediaState('volume')
  const muted       = useMediaState('muted')
  const fullscreen  = useMediaState('fullscreen')
  const canPlay     = useMediaState('canPlay')
  const remote      = useMediaRemote()

  const [showSpeed,    setShowSpeed]    = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [scrubbing,    setScrubbing]    = useState(false)
  const [scrubValue,   setScrubValue]   = useState(0)
  const progressRef = useRef<HTMLDivElement>(null)

  const displayTime = scrubbing ? scrubValue : (currentTime ?? 0)
  const pct = duration > 0 ? (displayTime / duration) * 100 : 0

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!progressRef.current || duration <= 0) return
    const rect = progressRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const time = ratio * duration
    remote.seek(time)
    onSeek(time)
  }

  function handleProgressMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!scrubbing || !progressRef.current || duration <= 0) return
    const rect = progressRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setScrubValue(ratio * duration)
  }

  function handleProgressMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    setScrubbing(true)
    handleProgressClick(e)
  }

  function handleProgressMouseUp() {
    if (scrubbing) {
      remote.seek(scrubValue)
      onSeek(scrubValue)
      setScrubbing(false)
    }
  }

  function handleSpeedChange(rate: number) {
    setPlaybackRate(rate)
    remote.changePlaybackRate(rate)
    setShowSpeed(false)
  }

  return (
    <div className="bg-slate-900 px-4 py-3 space-y-2">
      {/* Progress bar */}
      <div
        ref={progressRef}
        className="relative h-2 bg-zinc-700 rounded-full cursor-pointer group"
        onClick={handleProgressClick}
        onMouseDown={handleProgressMouseDown}
        onMouseMove={handleProgressMouseMove}
        onMouseUp={handleProgressMouseUp}
        onMouseLeave={handleProgressMouseUp}
      >
        {/* Filled portion */}
        <div
          className="absolute inset-y-0 left-0 bg-brand-500 rounded-full transition-none"
          style={{ width: `${pct}%` }}
        />
        {/* Scrubber handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-zinc-900 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity -ml-1.5"
          style={{ left: `${pct}%` }}
        />
        {/* Comment markers */}
        {duration > 0 && comments.map(c => (
          <button
            key={c.id}
            title={`${formatTime(c.timestamp)} — ${c.userName}: ${c.text}`}
            onClick={e => { e.stopPropagation(); remote.seek(c.timestamp); onSeek(c.timestamp) }}
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-amber-400 rounded-full border border-amber-600 shadow hover:scale-150 transition-transform -ml-1.5 z-10"
            style={{ left: `${(c.timestamp / duration) * 100}%` }}
          />
        ))}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3">
        {/* Play/pause */}
        <button
          onClick={() => paused ? remote.play() : remote.pause()}
          disabled={!canPlay}
          className="text-white hover:text-brand-400 transition-colors disabled:opacity-40"
        >
          {paused
            ? <Play className="w-5 h-5 fill-current" />
            : <Pause className="w-5 h-5 fill-current" />
          }
        </button>

        {/* Time */}
        <span className="text-xs text-zinc-300 tabular-nums font-mono">
          {formatTime(displayTime)} / {formatTime(duration)}
        </span>

        <div className="flex-1" />

        {/* Volume */}
        <div className="flex items-center gap-1.5 group">
          <button
            onClick={() => muted ? remote.unmute() : remote.mute()}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            {muted || volume === 0
              ? <VolumeX className="w-4 h-4" />
              : <Volume2 className="w-4 h-4" />
            }
          </button>
          <input
            type="range"
            min="0" max="1" step="0.02"
            value={muted ? 0 : volume}
            onChange={e => { remote.unmute(); remote.changeVolume(Number(e.target.value)) }}
            className="w-16 accent-brand-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>

        {/* Playback speed */}
        <div className="relative">
          <button
            onClick={() => setShowSpeed(v => !v)}
            className="flex items-center gap-0.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          >
            {playbackRate}×
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSpeed && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSpeed(false)} />
              <div className="absolute bottom-full right-0 mb-1 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                {SPEEDS.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSpeedChange(s)}
                    className={cn(
                      'block w-full px-4 py-1.5 text-xs text-left hover:bg-zinc-700 transition-colors',
                      playbackRate === s ? 'text-brand-400 font-bold' : 'text-zinc-300',
                    )}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Fullscreen */}
        <button
          onClick={() => fullscreen ? remote.exitFullscreen() : remote.enterFullscreen()}
          className="text-zinc-400 hover:text-white transition-colors"
        >
          {fullscreen
            ? <Minimize className="w-4 h-4" />
            : <Maximize className="w-4 h-4" />
          }
        </button>
      </div>
    </div>
  )
}

// ── Main VideoPlayer page ─────────────────────────────────────────────────────

export default function VideoPlayer() {
  const { id } = useParams<{ id: string }>()
  const { profile, roles } = useAuth()
  const { config, isConfigured, isMsSignedIn, signInWithMicrosoft, getAccessToken } = useMicrosoftAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isTeacher = roles.includes('teacher') || roles.includes('admin')
  const backPath = isTeacher ? '/teacher/videos' : '/videos'

  const { data: video, loading: videoLoading } = useDocument<VideoDoc>('videos', id)

  const [videoUrl,  setVideoUrl]  = useState<string | null>(null)
  const [urlError,  setUrlError]  = useState<string | null>(null)
  const [duration,  setDuration]  = useState(0)
  const [comments,  setComments]  = useState<VideoCommentDoc[]>([])
  const [commentInput, setCommentInput] = useState('')
  const [captureTs,    setCaptureTs]    = useState<number | null>(null)
  const [submitting,   setSubmitting]   = useState(false)
  const [seekTarget,   setSeekTarget]   = useState<number | null>(null)

  // Teacher review state
  const [reviewing,   setReviewing]   = useState(false)
  const [grade,       setGrade]       = useState<string>('')
  const [feedbackTxt, setFeedbackTxt] = useState('')
  const [saving,      setSaving]      = useState(false)

  // Load comments
  useEffect(() => {
    if (!id) return
    const q = query(
      collection(db, `video_comments/${id}/comments`),
      orderBy('timestamp', 'asc'),
    )
    return onSnapshot(q, snap => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as VideoCommentDoc)))
    })
  }, [id])

  // Get video URL from Graph API
  useEffect(() => {
    if (!video || !isConfigured || !isMsSignedIn || !config) return
    ;(async () => {
      try {
        const token = await getAccessToken()
        if (!token) return
        const item = await getItemDetails(token, config.siteId, video.sharePointItemId)
        const url = item['@microsoft.graph.downloadUrl']
        if (url) setVideoUrl(url)
        else setUrlError('Could not get download URL from SharePoint.')
      } catch (e: any) {
        setUrlError(e.message)
      }
    })()
  }, [video, isConfigured, isMsSignedIn, config, getAccessToken])

  // Pre-fill review fields
  useEffect(() => {
    if (video) {
      setGrade(video.grade !== null && video.grade !== undefined ? String(video.grade) : '')
      setFeedbackTxt(video.feedback ?? '')
    }
  }, [video])

  const handleSeek = useCallback((t: number) => {
    setSeekTarget(t)
    setCaptureTs(Math.round(t))
  }, [])

  async function addComment() {
    if (!profile || !id || !commentInput.trim()) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, `video_comments/${id}/comments`), {
        videoId:      id,
        userId:       profile.uid,
        userName:     profile.displayName,
        userAvatarUrl: profile.avatarUrl ?? null,
        userRole:     profile.role,
        timestamp:    captureTs ?? 0,
        text:         commentInput.trim(),
        createdAt:    serverTimestamp(),
      })
      setCommentInput('')
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteComment(commentId: string) {
    if (!id || !confirm('Delete this comment?')) return
    await deleteDoc(doc(db, `video_comments/${id}/comments`, commentId))
  }

  async function saveReview() {
    if (!id) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'videos', id), {
        reviewStatus: 'reviewed',
        grade:       grade ? Number(grade) : null,
        feedback:    feedbackTxt.trim() || null,
        gradedBy:    profile?.uid ?? null,
        gradedAt:    serverTimestamp(),
      })
      setReviewing(false)
    } finally {
      setSaving(false)
    }
  }

  if (videoLoading) return <LoadingSpinner />
  if (!video) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-400">
      <p>Video not found.</p>
      <Link to={backPath} className="text-brand-500 hover:underline text-sm">Go back</Link>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-zinc-900 flex-shrink-0">
        <button onClick={() => navigate(backPath)} className="p-1.5 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-zinc-100 truncate">{video.name}</h1>
          <p className="text-xs text-zinc-400">
            {video.uploaderName}
            {video.createdAt && <> · {format(video.createdAt.toDate(), 'd MMM yyyy')}</>}
          </p>
        </div>
        {video.reviewStatus === 'reviewed' && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-800/50">
            <CheckCircle2 className="w-3.5 h-3.5" /> Reviewed
            {video.grade !== null && <> · {video.grade}/100</>}
          </span>
        )}
      </div>

      {/* Body: player + comments */}
      <div className="flex flex-1 overflow-hidden">
        {/* Player side */}
        <div className="flex-1 bg-black flex flex-col overflow-hidden">
          {!isMsSignedIn ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-white">
              <p className="text-zinc-400 text-sm">Sign in with Microsoft to stream this video.</p>
              <button
                onClick={() => signInWithMicrosoft().catch(e => setUrlError(e.message))}
                className="btn-primary py-2 px-5"
              >
                Sign in with Microsoft 365
              </button>
              {urlError && <p className="text-xs text-rose-400">{urlError}</p>}
            </div>
          ) : videoUrl ? (
            <MediaPlayer
              src={videoUrl}
              className="flex-1"
              onLoadedMetadata={e => { const v = (e.target as unknown as HTMLVideoElement); if (v?.duration) setDuration(v.duration) }}
              style={{ height: '100%', width: '100%' }}
            >
              <MediaProvider className="h-full w-full [&>video]:h-full [&>video]:w-full [&>video]:object-contain" />
              <VideoControls
                duration={duration}
                comments={comments}
                onSeek={handleSeek}
              />
            </MediaPlayer>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-400 gap-2">
              <LoadingSpinner />
            </div>
          )}
          {urlError && videoUrl && (
            <div className="px-4 py-2 bg-rose-900/50 text-rose-300 text-xs">{urlError}</div>
          )}
        </div>

        {/* Comments panel */}
        <div className="w-80 flex-shrink-0 bg-zinc-900 border-l border-white/10 flex flex-col overflow-hidden">
          {/* Teacher review section */}
          {isTeacher && (
            <div className="border-b border-white/10 flex-shrink-0">
              {reviewing ? (
                <div className="p-4 space-y-3">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Review</p>
                  <div>
                    <label className="text-xs font-medium text-zinc-400 block mb-1">Grade (0–100)</label>
                    <input
                      type="number" min="0" max="100"
                      className="input py-1.5 text-sm w-24"
                      value={grade}
                      onChange={e => setGrade(e.target.value)}
                      placeholder="–"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-400 block mb-1">Feedback</label>
                    <textarea
                      rows={3}
                      className="input text-sm py-2 resize-none"
                      value={feedbackTxt}
                      onChange={e => setFeedbackTxt(e.target.value)}
                      placeholder="Written feedback…"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveReview} disabled={saving} className="btn-primary py-1.5 text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {saving ? 'Saving…' : 'Mark reviewed'}
                    </button>
                    <button onClick={() => setReviewing(false)} className="btn-secondary py-1.5 text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setReviewing(true)}
                  className="w-full px-4 py-3 text-sm font-medium text-zinc-400 hover:bg-white/5 flex items-center gap-2 transition-colors"
                >
                  <Star className="w-4 h-4 text-amber-500" />
                  {video.reviewStatus === 'reviewed' ? 'Edit review' : 'Write review'}
                  {video.grade !== null && <span className="ml-auto text-xs text-zinc-400">{video.grade}/100</span>}
                </button>
              )}
              {video.feedback && !reviewing && (
                <div className="px-4 pb-3 text-xs text-zinc-400 border-t border-white/8 pt-2 bg-zinc-900/50">
                  <p className="font-medium text-zinc-300 mb-1">Feedback</p>
                  <p className="leading-relaxed">{video.feedback}</p>
                </div>
              )}
            </div>
          )}

          {/* Comments header */}
          <div className="px-4 py-3 border-b border-white/8 flex-shrink-0">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
              Timeline comments ({comments.length})
            </p>
          </div>

          {/* Comment list */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
            {comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-zinc-400 text-xs gap-1">
                <p>No comments yet.</p>
                <p>Play the video and add a comment at any timestamp.</p>
              </div>
            ) : (
              comments.map(c => (
                <div
                  key={c.id}
                  className="px-4 py-3 hover:bg-white/5 group cursor-pointer transition-colors"
                  onClick={() => {
                    setSeekTarget(c.timestamp)
                    setCaptureTs(Math.round(c.timestamp))
                  }}
                >
                  <div className="flex items-start gap-2">
                    <Avatar uid={c.userId} name={c.userName} avatarUrl={c.userAvatarUrl} size="xs" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-zinc-200">{c.userName}</span>
                        <button
                          onClick={e => { e.stopPropagation(); setSeekTarget(c.timestamp); setCaptureTs(Math.round(c.timestamp)) }}
                          className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium hover:bg-amber-200 transition-colors flex-shrink-0"
                        >
                          {formatTime(c.timestamp)}
                        </button>
                        <span className="text-[10px] text-zinc-400 capitalize">{c.userRole}</span>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed">{c.text}</p>
                    </div>
                    {(c.userId === profile?.uid || isTeacher) && (
                      <button
                        onClick={e => { e.stopPropagation(); deleteComment(c.id) }}
                        className="p-1 text-zinc-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all rounded flex-shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add comment */}
          <div className="border-t border-white/10 p-3 flex-shrink-0 space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>Timestamp:</span>
              <button
                onClick={() => setCaptureTs(null)}
                className={cn(
                  'px-2 py-0.5 rounded-full font-medium transition-colors',
                  captureTs !== null
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-zinc-800 text-zinc-500',
                )}
              >
                {captureTs !== null ? formatTime(captureTs) : 'Not set — play & pause to set'}
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={commentInput}
                onChange={e => setCommentInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addComment()}
                placeholder="Add a comment…"
                className="flex-1 text-sm bg-zinc-900/50 border border-white/10 rounded-xl px-3 py-2 outline-none focus:border-brand-400 transition-colors"
              />
              <button
                onClick={addComment}
                disabled={!commentInput.trim() || submitting}
                className={cn(
                  'p-2 rounded-xl transition-all',
                  commentInput.trim()
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'bg-zinc-800 text-zinc-300 cursor-not-allowed',
                )}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
