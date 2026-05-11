import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Pencil, Trash2, Eye, EyeOff } from 'lucide-react'
import { doc, deleteDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import { shortDate } from '@/lib/utils'
import type { AssignmentDoc, SubjectDoc, CohortDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'

export default function Assignments() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: assignments, loading } = useCollection<AssignmentDoc>('assignments')
  const { data: subjects }             = useCollection<SubjectDoc>('subjects')
  const { data: cohorts }              = useCollection<CohortDoc>('cohorts')

  const subjectMap = useMemo(() => Object.fromEntries(subjects.map(s => [s.id, s])), [subjects])
  const cohortMap  = useMemo(() => Object.fromEntries(cohorts.map(c => [c.id, c])), [cohorts])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return [...assignments]
      .filter(a => !q || a.title.toLowerCase().includes(q) || subjectMap[a.subjectId]?.title.toLowerCase().includes(q))
      .sort((a, b) => (b.dueDate?.toMillis?.() ?? 0) - (a.dueDate?.toMillis?.() ?? 0))
  }, [assignments, search, subjectMap])

  async function togglePublish(a: AssignmentDoc) {
    await updateDoc(doc(db, 'assignments', a.id), { isPublished: !a.isPublished })
  }

  async function handleDelete(a: AssignmentDoc) {
    if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return
    await deleteDoc(doc(db, 'assignments', a.id))
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Assignments</h1>
          <p className="text-zinc-400 text-sm mt-1">{assignments.length} total</p>
        </div>
        <Link to="/teacher/assignments/new" className="btn bg-brand-600 text-white hover:bg-brand-500 py-2.5">
          <Plus className="w-4 h-4" /> New Assignment
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search assignments…"
          className="input pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          {search ? 'No assignments match your search.' : 'No assignments yet. Create one to get started.'}
        </div>
      ) : (
        <>
          {/* ── Desktop table ─────────────────────────────────────────────── */}
          <div className="hidden sm:block bg-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Title</th>
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Subject</th>
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Class</th>
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Due</th>
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Points</th>
                  <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {filtered.map(a => {
                  const subject = subjectMap[a.subjectId]
                  const cohort  = cohortMap[a.cohortId]
                  return (
                    <tr key={a.id} className="hover:bg-zinc-700/40 transition-colors group">
                      <td className="px-4 py-3">
                        <p className="font-medium text-white truncate max-w-[220px]">{a.title}</p>
                        {a.description && (
                          <p className="text-xs text-zinc-400 truncate max-w-[220px] mt-0.5">{a.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {subject ? (
                          <span className="text-zinc-300">{subject.iconEmoji} {subject.title}</span>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{cohort?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">{shortDate(a.dueDate)}</td>
                      <td className="px-4 py-3">
                        <span className="text-amber-400 font-medium">+{a.pointsValue}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'badge',
                          a.isPublished ? 'bg-emerald-600 text-white' : 'bg-zinc-700 text-zinc-400',
                        )}>
                          {a.isPublished ? 'Published' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                          <button
                            onClick={() => togglePublish(a)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-slate-600 transition-colors"
                            title={a.isPublished ? 'Unpublish' : 'Publish'}
                          >
                            {a.isPublished ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => navigate(`/teacher/assignments/${a.id}/edit`)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-slate-600 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(a)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-slate-600 transition-colors"
                            title="Delete"
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

          {/* ── Mobile cards ──────────────────────────────────────────────── */}
          <div className="sm:hidden space-y-3">
            {filtered.map(a => {
              const subject = subjectMap[a.subjectId]
              const cohort  = cohortMap[a.cohortId]
              return (
                <div key={a.id} className="bg-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{a.title}</p>
                      {a.description && (
                        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{a.description}</p>
                      )}
                    </div>
                    <span className={cn(
                      'badge flex-shrink-0',
                      a.isPublished ? 'bg-emerald-600 text-white' : 'bg-zinc-700 text-zinc-400',
                    )}>
                      {a.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                    {subject && <span>{subject.iconEmoji} {subject.title}</span>}
                    {cohort && <span>{cohort.name}</span>}
                    <span>Due {shortDate(a.dueDate)}</span>
                    <span className="text-amber-400 font-medium">+{a.pointsValue} pts</span>
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-slate-700">
                    <button
                      onClick={() => togglePublish(a)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                    >
                      {a.isPublished ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {a.isPublished ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      onClick={() => navigate(`/teacher/assignments/${a.id}/edit`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(a)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-rose-400 hover:bg-zinc-700 transition-colors ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
