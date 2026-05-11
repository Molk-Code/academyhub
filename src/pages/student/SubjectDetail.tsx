import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useDocument, useCollection, orderBy, where } from '@/hooks/useFirestore'
import { useAuth } from '@/contexts/AuthContext'
import type { SubjectDoc, SubjectTeacherDoc, LessonDoc, VideoLabDoc, AbsenceReportDoc } from '@/types'
import { thumbnailUrl } from '@/lib/cloudinary'
import { ArrowLeft, Link2, FileText, ExternalLink, UserRound, CheckCircle2, XCircle, Globe, Play, Clock } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import SharePointBrowser from '@/components/sharepoint/SharePointBrowser'

export default function StudentSubjectDetail() {
  const { id } = useParams<{ id: string }>()
  const { cohortId, previewCohortId, profile } = useAuth()
  const effectiveCohortId = previewCohortId ?? cohortId
  const { data: subject, loading } = useDocument<SubjectDoc>('subjects', id)
  const { data: teachers } = useCollection<SubjectTeacherDoc>(
    `subjects/${id}/teachers`,
    [orderBy('order', 'asc')],
    !!id,
    id ?? '',
  )
  const { data: lessons } = useCollection<LessonDoc>(
    'lessons',
    effectiveCohortId && id ? [where('cohortId', '==', effectiveCohortId), where('subjectId', '==', id)] : [],
    !!(effectiveCohortId && id),
    `${effectiveCohortId}-${id}`,
  )
  const { data: subjectVideos } = useCollection<VideoLabDoc>(
    'video_lab',
    id ? [where('subjectId', '==', id), orderBy('createdAt', 'desc')] : [],
    !!id,
    `videos-${id}`,
  )

  // Student's absence reports for lessons in this subject
  const { data: myAbsences } = useCollection<AbsenceReportDoc>(
    'absence_reports',
    profile ? [where('studentId', '==', profile.uid)] : [],
    !!profile,
    profile?.uid ?? '',
  )
  const absentLessonIds = useMemo(() => new Set(myAbsences.map(r => r.lessonId).filter(Boolean) as string[]), [myAbsences])

  const curriculum = useMemo(
    () => [...(subject?.curriculum ?? [])].sort((a, b) => a.order - b.order),
    [subject],
  )
  const resources = subject?.resources ?? []

  const semesters = useMemo(() => {
    const nums = curriculum.map(i => i.semester)
    const set = Array.from(new Set(nums)).sort((a, b) => a - b)
    return set
  }, [curriculum])

  // coveredIds: curriculum IDs covered in past lessons
  // absentCoveredIds: curriculum IDs the student missed (was absent)
  const { coveredIds, absentCoveredIds } = useMemo(() => {
    const now = new Date()
    const covered = new Set<string>()
    const absentCovered = new Set<string>()
    for (const l of lessons) {
      const lessonDate = l.startTime?.toDate?.()
      if (!lessonDate || lessonDate > now) continue
      for (const cid of (l.coveredCurriculumIds ?? [])) {
        covered.add(cid)
        if (absentLessonIds.has(l.id)) absentCovered.add(cid)
      }
    }
    return { coveredIds: covered, absentCoveredIds: absentCovered }
  }, [lessons, absentLessonIds])

  const curriculumProgress = curriculum.length > 0
    ? Math.round((coveredIds.size / curriculum.length) * 100)
    : 0

  if (loading) return <LoadingSpinner />
  if (!subject) return (
    <div className="text-center py-20 text-zinc-400">
      Subject not found. <Link to="/subjects" className="text-brand-500 underline">Go back</Link>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link to="/subjects" className="mt-1 p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-xl transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{subject.iconEmoji}</span>
            <div>
              <h1 className="page-title">{subject.title}</h1>
              <p className="text-zinc-500 text-sm mt-0.5">{subject.description}</p>
            </div>
          </div>

        </div>
      </div>

      {/* Curriculum */}
      {semesters.length > 0 && (
        <div className="space-y-4">
          {curriculum.length > 0 && (
            <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm px-5 py-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-semibold text-zinc-300">Curriculum progress</span>
                <span className="text-zinc-500">{coveredIds.size} / {curriculum.length} topics covered · <span className="font-medium text-zinc-300">{curriculumProgress}%</span></span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${subject.color}`}
                  style={{ width: `${curriculumProgress}%` }}
                />
              </div>
            </div>
          )}
          {semesters.map(sem => {
            const items = curriculum.filter(i => i.semester === sem).sort((a, b) => a.order - b.order)
            return (
              <div key={sem} className="bg-zinc-900 rounded-2xl overflow-hidden border border-white/10 shadow-sm">
                <div className={`px-5 py-3 ${subject.color}`}>
                  <h2 className="text-sm font-bold text-white tracking-wide">Semester {sem}</h2>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/8">
                      <th className="w-8 px-4 py-2.5" />
                      <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-2.5 w-1/3">Topic</th>
                      <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-2.5">Content</th>
                      <th className="text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider px-4 py-2.5 w-32">How</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map(item => {
                      const covered = coveredIds.has(item.id)
                      const wasAbsent = absentCoveredIds.has(item.id)
                      return (
                        <tr key={item.id} className={`hover:bg-white/5 transition-colors ${wasAbsent ? 'bg-rose-50/30' : covered ? 'bg-emerald-50/40' : ''}`}>
                          <td className="px-4 py-3 text-center">
                            {wasAbsent
                              ? <span title="You were absent during this lesson"><XCircle className="w-4 h-4 text-rose-500 mx-auto" /></span>
                              : covered
                                ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                                : null
                            }
                          </td>
                          <td className={`px-4 py-3 text-sm font-medium ${wasAbsent ? 'text-rose-300' : covered ? 'text-emerald-300' : 'text-zinc-100'}`}>{item.title}</td>
                          <td className="px-4 py-3 text-sm text-zinc-400">{item.content}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{item.method}</span>
                          </td>
                        </tr>
                      )
                    })}
                    {items.length === 0 && (
                      <tr><td colSpan={4} className="px-5 py-4 text-sm text-zinc-400 text-center">No items yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {/* Resources */}
      {resources.length > 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-white/8">
            <h2 className="text-base font-semibold text-zinc-100">Resources</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {resources.map(res => (
              <li key={res.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors">
                {res.type === 'link'
                  ? <Link2 className="w-4 h-4 text-brand-500 flex-shrink-0" />
                  : <FileText className="w-4 h-4 text-amber-500 flex-shrink-0" />
                }
                <a
                  href={res.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-sm font-medium text-zinc-200 hover:text-brand-600 transition-colors flex items-center gap-1.5 min-w-0"
                >
                  <span className="truncate">{res.title}</span>
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Subject Videos */}
      {subjectVideos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-zinc-100">Videos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {subjectVideos.map(video => (
              <Link
                key={video.id}
                to={`/video-lab/${video.id}`}
                className="group bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden shadow-sm hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
              >
                <div className="relative aspect-video bg-slate-900 overflow-hidden">
                  <img src={thumbnailUrl(video.cloudinaryPublicId)} alt={video.title} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" loading="lazy" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <Play className="w-4 h-4 text-zinc-100 ml-0.5" />
                    </div>
                  </div>
                  {video.duration > 0 && (
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />{Math.floor(video.duration/60)}:{String(video.duration%60).padStart(2,'0')}
                    </div>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-sm font-medium text-zinc-100 line-clamp-1">{video.title}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{video.uploaderName}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* SharePoint Resources */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-100">Shared Files</h2>
        <SharePointBrowser
          subPath={`Resources/${id}`}
          canDelete={false}
          canUpload={false}
          title="Subject Files"
        />
      </div>

      {/* Teachers */}
      {teachers.length > 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-white/8">
            <h2 className="text-base font-semibold text-zinc-100">Teachers</h2>
          </div>
          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
            {teachers.map(t => (
              <div key={t.id} className="flex flex-col items-center text-center gap-3">
                {t.imageUrl ? (
                  <img src={t.imageUrl} alt={t.name} className="w-32 h-32 rounded-full object-cover ring-4 ring-white shadow-md" />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-zinc-800 flex items-center justify-center ring-4 ring-white shadow-md">
                    <UserRound className="w-14 h-14 text-zinc-300" />
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-sm text-zinc-100">{t.name}</span>
                    {t.isGuest && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Guest</span>}
                  </div>
                  {t.title && <p className="text-xs text-brand-600 font-medium mt-0.5">{t.title}</p>}
                  {t.description && <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.description}</p>}
                  {t.portfolioUrl && (
                    <a href={t.portfolioUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-500 hover:underline mt-1.5">
                      <Globe className="w-3 h-3" /> Portfolio
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {semesters.length === 0 && resources.length === 0 && teachers.length === 0 && (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-sm">No content has been added to this subject yet.</p>
        </div>
      )}
    </div>
  )
}
