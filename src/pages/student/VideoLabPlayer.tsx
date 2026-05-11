import { useState, useRef, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useDocument, useCollection, orderBy } from '@/hooks/useFirestore'
import type { VideoLabDoc, VideoLabCommentDoc, SubjectDoc } from '@/types'
import { videoUrl } from '@/lib/cloudinary'
import { ArrowLeft, MessageSquare, Trash2, Send, Clock, Tag } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function VideoLabPlayer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile, role } = useAuth()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)

  const { data: video, loading } = useDocument<VideoLabDoc>('video_lab', id)
  const { data: comments } = useCollection<VideoLabCommentDoc>(
    `video_lab/${id}/comments`,
    [orderBy('timestampSeconds', 'asc')],
    !!id,
    id ?? '',
  )
  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const subj = useMemo(() => subjects.find(s => s.id === video?.subjectId), [subjects, video])

  async function postComment() {
    if (!profile || !commentText.trim() || !id) return
    setPosting(true)
    try {
      await addDoc(collection(db, `video_lab/${id}/comments`), {
        text: commentText.trim(),
        timestampSeconds: Math.floor(currentTime),
        userId: profile.uid,
        userName: profile.displayName ?? 'Unknown',
        createdAt: serverTimestamp(),
      })
      setCommentText('')
    } finally {
      setPosting(false)
    }
  }

  async function deleteComment(commentId: string) {
    if (!id) return
    await deleteDoc(doc(db, `video_lab/${id}/comments`, commentId))
  }

  function seekTo(secs: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = secs
      videoRef.current.play()
    }
  }

  if (loading) return <LoadingSpinner />
  if (!video) return (
    <div className="text-center py-20 text-zinc-400">
      Video not found.{' '}
      <Link to="/video-lab" className="text-brand-500 underline">Go back</Link>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate(-1)} className="mt-1 p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title">{video.title}</h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">Beta</span>
          </div>
          <p className="text-zinc-400 text-sm mt-0.5">
            {video.uploaderName}
            {subj && ` · ${subj.iconEmoji} ${subj.title}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: video + comment input */}
        <div className="lg:col-span-2 space-y-4">
          {/* Player */}
          <div className="bg-black rounded-2xl overflow-hidden aspect-video shadow-lg">
            <video
              ref={videoRef}
              src={videoUrl(video.cloudinaryPublicId)}
              controls
              className="w-full h-full"
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
            />
          </div>

          {video.description && (
            <p className="text-zinc-400 text-sm leading-relaxed">{video.description}</p>
          )}

          {(video.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {video.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-amber-950/40 text-amber-300 border border-amber-800/50">
                  <Tag className="w-3 h-3" />{t}
                </span>
              ))}
            </div>
          )}

          {/* Comment input */}
          <div className="bg-zinc-900 rounded-2xl border border-white/10 p-4">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              Comment at{' '}
              <span className="font-mono text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded-md">{formatTime(currentTime)}</span>
            </p>
            <div className="flex gap-2">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && postComment()}
                className="input flex-1 text-sm"
                placeholder="What's happening at this moment in the video?"
              />
              <button
                onClick={postComment}
                disabled={!commentText.trim() || posting}
                className="btn-primary py-2 px-4 text-sm gap-1.5"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: timeline comments */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-zinc-400" />
            Timeline
            <span className="ml-1 text-xs font-normal text-zinc-400">({comments.length})</span>
          </h2>

          {comments.length === 0 ? (
            <div className="bg-zinc-900 rounded-2xl border border-white/10 p-6 text-center">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm text-zinc-400">No comments yet. Pause the video and leave a note!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-0.5">
              {comments.map(c => (
                <div
                  key={c.id}
                  className="bg-zinc-900 rounded-xl border border-white/10 p-3 group hover:border-brand-200 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <button
                      onClick={() => seekTo(c.timestampSeconds)}
                      title={`Jump to ${formatTime(c.timestampSeconds)}`}
                      className="font-mono text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full hover:bg-brand-100 transition-colors"
                    >
                      ▶ {formatTime(c.timestampSeconds)}
                    </button>
                    {(profile?.uid === c.userId || role === 'admin' || role === 'teacher') && (
                      <button
                        onClick={() => deleteComment(c.id)}
                        className="p-1 text-slate-200 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-zinc-200 leading-snug">{c.text}</p>
                  <p className="text-xs text-zinc-400 mt-1">{c.userName}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
