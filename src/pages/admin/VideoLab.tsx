import { deleteDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { VideoLabDoc, SubjectDoc } from '@/types'
import { thumbnailUrl, videoUrl } from '@/lib/cloudinary'
import { Trash2, ExternalLink, Film } from 'lucide-react'
import { Link } from 'react-router-dom'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function AdminVideoLab() {
  const { data: videos } = useCollection<VideoLabDoc>('video_lab', [orderBy('createdAt', 'desc')])
  const { data: subjects } = useCollection<SubjectDoc>('subjects')

  const totalSeconds = videos.reduce((sum, v) => sum + (v.duration ?? 0), 0)
  const uploaderCount = new Set(videos.map(v => v.uploaderId)).size

  async function deleteVideo(id: string) {
    if (!confirm('Remove this video from Firestore? The Cloudinary file will remain until manually deleted there.')) return
    await deleteDoc(doc(db, 'video_lab', id))
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="page-title flex items-center gap-2"><Film className="w-5 h-5" /> Video Lab</h1>
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">Beta</span>
        </div>
        <p className="text-zinc-500 text-sm mt-1">Manage all Video Lab uploads across the school.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 text-center">
          <p className="text-3xl font-bold text-zinc-100">{videos.length}</p>
          <p className="text-xs text-zinc-400 mt-1">Total videos</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 text-center">
          <p className="text-3xl font-bold text-zinc-100">{totalSeconds > 0 ? formatDuration(totalSeconds) : '—'}</p>
          <p className="text-xs text-zinc-400 mt-1">Total runtime</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-5 text-center">
          <p className="text-3xl font-bold text-zinc-100">{uploaderCount}</p>
          <p className="text-xs text-zinc-400 mt-1">Uploaders</p>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🎬</div>
          <p className="text-zinc-500 font-medium">No videos uploaded yet</p>
          <p className="text-zinc-400 text-sm mt-1">Teachers can upload videos from the Teacher Portal.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/8 bg-zinc-900/50/50">
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-5 py-3">Video</th>
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Uploader</th>
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Subject</th>
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Duration</th>
                <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-3">Tags</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {videos.map(video => {
                const subj = subjects.find(s => s.id === video.subjectId)
                return (
                  <tr key={video.id} className="hover:bg-white/5/80 transition-colors">
                    <td className="px-5 py-3">
                      <Link to={`/admin/video-lab/${video.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <div className="w-16 h-10 rounded-lg overflow-hidden bg-slate-900 flex-shrink-0">
                          <img src={thumbnailUrl(video.cloudinaryPublicId)} alt="" className="w-full h-full object-cover" />
                        </div>
                        <p className="text-sm font-medium text-zinc-100 truncate max-w-[200px]">{video.title}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400 whitespace-nowrap">{video.uploaderName}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400">{subj ? `${subj.iconEmoji} ${subj.title}` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400 font-mono whitespace-nowrap">
                      {video.duration > 0 ? formatDuration(video.duration) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(video.tags ?? []).map(t => (
                          <span key={t} className="text-xs bg-amber-950/40 text-amber-300 px-1.5 py-0.5 rounded-full border border-amber-800/50">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <a
                          href={videoUrl(video.cloudinaryPublicId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-zinc-400 hover:text-brand-600 transition-colors rounded-lg hover:bg-brand-50"
                          title="Open video"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => deleteVideo(video.id)}
                          className="p-1.5 text-zinc-400 hover:text-rose-500 transition-colors rounded-lg hover:bg-rose-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
