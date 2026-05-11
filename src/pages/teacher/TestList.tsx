import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Pencil, Eye, EyeOff, ClipboardList } from 'lucide-react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, where } from '@/hooks/useFirestore'
import { shortDate } from '@/lib/utils'
import type { TestDoc, AssignmentDoc, SubjectDoc, CohortDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'

export default function TestList() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: tests,    loading }  = useCollection<TestDoc>('tests')
  const { data: assignments }        = useCollection<AssignmentDoc>('assignments', [where('type', '==', 'test')])
  const { data: subjects }           = useCollection<SubjectDoc>('subjects')
  const { data: cohorts }            = useCollection<CohortDoc>('cohorts')

  const assignmentMap = useMemo(() => Object.fromEntries(assignments.map(a => [a.id, a])), [assignments])
  const subjectMap    = useMemo(() => Object.fromEntries(subjects.map(s => [s.id, s])), [subjects])
  const cohortMap     = useMemo(() => Object.fromEntries(cohorts.map(c => [c.id, c])), [cohorts])

  const rows = useMemo(() => {
    return tests
      .map(t => ({ test: t, assignment: assignmentMap[t.assignmentId] }))
      .filter(({ assignment }) => {
        if (!assignment) return false
        const q = search.toLowerCase()
        if (!q) return true
        return assignment.title.toLowerCase().includes(q) ||
          subjectMap[assignment.subjectId]?.title.toLowerCase().includes(q)
      })
      .sort((a, b) => (b.assignment?.dueDate?.toMillis?.() ?? 0) - (a.assignment?.dueDate?.toMillis?.() ?? 0))
  }, [tests, assignmentMap, search, subjectMap])

  async function togglePublish(assignment: AssignmentDoc, test: TestDoc) {
    const next = !assignment.isPublished
    await Promise.all([
      updateDoc(doc(db, 'assignments', assignment.id), { isPublished: next }),
      updateDoc(doc(db, 'tests', test.id), { isPublished: next }),
    ])
  }

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Theory Tests</h1>
          <p className="text-zinc-400 text-sm mt-1">{tests.length} test{tests.length !== 1 ? 's' : ''}</p>
        </div>
        <Link to="/teacher/tests/new" className="btn bg-brand-600 text-white hover:bg-brand-500 py-2.5">
          <Plus className="w-4 h-4" /> New Test
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tests…"
          className="input pl-9"
        />
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          {search ? 'No tests match your search.' : 'No tests yet. Create one to get started.'}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-700 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Title</th>
                <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Subject</th>
                <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Class</th>
                <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Questions</th>
                <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Due</th>
                <th className="px-4 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {rows.map(({ test, assignment }) => {
                if (!assignment) return null
                const subject = subjectMap[assignment.subjectId]
                const cohort  = cohortMap[assignment.cohortId]
                return (
                  <tr key={test.id} className="hover:bg-zinc-700/40 transition-colors group">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white truncate max-w-[200px]">{assignment.title}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {assignment.passingScore}% pass · {test.timeLimitMinutes ? `${test.timeLimitMinutes} min` : 'No limit'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {subject ? `${subject.iconEmoji} ${subject.title}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{cohort?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-300">{test.questions?.length ?? 0}</td>
                    <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">{shortDate(assignment.dueDate)}</td>
                    <td className="px-4 py-3">
                      {assignment.isPublished ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          Draft
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        <button
                          onClick={() => togglePublish(assignment, test)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-slate-600 transition-colors"
                          title={assignment.isPublished ? 'Unpublish' : 'Publish'}
                        >
                          {assignment.isPublished ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => navigate(`/teacher/tests/${test.id}/edit`)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-slate-600 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <Link
                          to={`/teacher/tests/${test.id}/submissions`}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-slate-600 transition-colors"
                          title="Review submissions"
                        >
                          <ClipboardList className="w-4 h-4" />
                        </Link>
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
