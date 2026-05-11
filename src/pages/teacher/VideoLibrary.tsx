import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Video, Play, CheckCircle2, Clock, Search, Filter, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import type { VideoDoc, SubjectDoc, CohortDoc, UserDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import Avatar from '@/components/common/Avatar'

export default function TeacherVideoLibrary() {
  const { data: subjects } = useCollection<SubjectDoc>('subjects')
  const { data: cohorts }  = useCollection<CohortDoc>('cohorts', [orderBy('name', 'asc')])
  const { data: students } = useCollection<UserDoc>('users', [where('role', '==', 'student')])
  const { data: allVideos, loading } = useCollection<VideoDoc>('videos', [orderBy('createdAt', 'desc')])

  const [cohortFilter,  setCohortFilter]  = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [studentFilter, setStudentFilter] = useState('')
  const [statusFilter,  setStatusFilter]  = useState<'' | 'pending' | 'reviewed'>('')
  const [search,        setSearch]        = useState('')

  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]))
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]))

  const visible = allVideos.filter(v => {
    if (cohortFilter  && v.cohortId  !== cohortFilter)  return false
    if (subjectFilter && v.subjectId !== subjectFilter) return false
    if (studentFilter && v.studentId !== studentFilter) return false
    if (statusFilter  && v.reviewStatus !== statusFilter) return false
    if (search && !v.name.toLowerCase().includes(search.toLowerCase()) &&
        !v.uploaderName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const cohortStudents = cohortFilter
    ? students.filter(s => s.cohortId === cohortFilter)
    : students

  const pending  = allVideos.filter(v => v.reviewStatus === 'pending').length
  const reviewed = allVideos.filter(v => v.reviewStatus === 'reviewed').length

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2"><Video className="w-6 h-6" /> Video Library</h1>
          <p className="text-zinc-500 text-sm mt-1">Review student submitted videos.</p>
        </div>
        {/* Stats */}
        <div className="flex items-center gap-3">
          <div className="text-center bg-amber-950/40 border border-amber-800/50 rounded-xl px-4 py-2">
            <p className="text-lg font-bold text-amber-700">{pending}</p>
            <p className="text-xs text-amber-600">Pending</p>
          </div>
          <div className="text-center bg-emerald-950/40 border border-emerald-800/50 rounded-xl px-4 py-2">
            <p className="text-lg font-bold text-emerald-700">{reviewed}</p>
            <p className="text-xs text-emerald-600">Reviewed</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-zinc-400 flex-shrink-0" />

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="input pl-8 py-1.5 text-sm w-44"
            />
          </div>

          <select className="input py-1.5 text-sm w-40" value={cohortFilter} onChange={e => { setCohortFilter(e.target.value); setStudentFilter('') }}>
            <option value="">All classes</option>
            {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <select className="input py-1.5 text-sm w-44" value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)}>
            <option value="">All subjects</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.iconEmoji} {s.title}</option>)}
          </select>

          <select className="input py-1.5 text-sm w-44" value={studentFilter} onChange={e => setStudentFilter(e.target.value)}>
            <option value="">All students</option>
            {cohortStudents.map(s => <option key={s.id} value={s.id}>{s.displayName}</option>)}
          </select>

          <select className="input py-1.5 text-sm w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
          </select>

          {(cohortFilter || subjectFilter || studentFilter || statusFilter || search) && (
            <button
              onClick={() => { setCohortFilter(''); setSubjectFilter(''); setStudentFilter(''); setStatusFilter(''); setSearch('') }}
              className="text-xs text-zinc-500 hover:text-zinc-300 underline"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-400 mt-2 pl-7">{visible.length} video{visible.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Video grid */}
      {visible.length === 0 ? (
        <div className="text-center py-16 text-zinc-400">
          <Video className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No videos match the current filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {visible.map(video => {
            const subject  = subjectMap[video.subjectId]
            const student  = studentMap[video.studentId]
            return (
              <Link
                key={video.id}
                to={`/teacher/videos/${video.id}`}
                className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden hover:shadow-md hover:border-white/15 transition-all group"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video bg-slate-900 overflow-hidden">
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt={video.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video className="w-8 h-8 text-zinc-300" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <Play className="w-4 h-4 text-zinc-200 fill-current" />
                    </div>
                  </div>
                  {/* Status */}
                  <div className="absolute top-2 right-2">
                    {video.reviewStatus === 'reviewed' ? (
                      <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Reviewed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                        <Clock className="w-2.5 h-2.5" /> Pending
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3">
                  <p className="font-semibold text-zinc-200 text-sm truncate mb-1">{video.name}</p>

                  {/* Student info */}
                  {student && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Avatar uid={student.id} name={student.displayName} avatarUrl={student.avatarUrl} size="xs" />
                      <span className="text-xs text-zinc-500 truncate">{student.displayName}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
                    {subject && <span>{subject.iconEmoji} {subject.title}</span>}
                    {video.createdAt && <span>· {format(video.createdAt.toDate(), 'd MMM')}</span>}
                  </div>

                  {video.grade !== null && (
                    <p className="text-xs text-emerald-600 font-medium mt-1">Grade: {video.grade}/100</p>
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
