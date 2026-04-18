import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronRight, UserCheck, UserX } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { UserDoc, CohortDoc, ProgressDoc } from '@/types'
import { pct } from '@/lib/utils'
import Avatar from '@/components/common/Avatar'
import XPBar from '@/components/dashboard/XPBar'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function Students() {
  const { profile } = useAuth()
  const [search,        setSearch]        = useState('')
  const [selectedCohort, setSelectedCohort] = useState('')

  const { data: cohorts } = useCollection<CohortDoc>(
    'cohorts',
    profile ? [where('teacherIds', 'array-contains', profile.uid)] : [],
    !!profile,
  )

  const { data: students, loading } = useCollection<UserDoc>(
    'users',
    [where('role', '==', 'student')],
  )

  const { data: progressDocs } = useCollection<ProgressDoc>('progress')
  const progressMap = Object.fromEntries(progressDocs.map(p => [p.studentId, p]))

  const cohortIds = cohorts.map(c => c.id)

  const filtered = students
    .filter(s => s.cohortId && cohortIds.includes(s.cohortId))
    .filter(s => !selectedCohort || s.cohortId === selectedCohort)
    .filter(s => s.displayName.toLowerCase().includes(search.toLowerCase()) ||
                 s.email.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title text-white">Students</h1>
        <p className="text-slate-400 text-sm mt-1">{filtered.length} students in your cohorts.</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search students…"
            className="input bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pl-9"
          />
        </div>
        <select
          value={selectedCohort}
          onChange={e => setSelectedCohort(e.target.value)}
          className="input bg-slate-800 border-slate-700 text-white max-w-[200px]"
        >
          <option value="">All cohorts</option>
          {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-xs font-medium text-slate-400 px-5 py-3">Student</th>
              <th className="text-left text-xs font-medium text-slate-400 px-4 py-3">Cohort</th>
              <th className="text-left text-xs font-medium text-slate-400 px-4 py-3 w-40">Progress</th>
              <th className="text-right text-xs font-medium text-slate-400 px-4 py-3">Points</th>
              <th className="text-right text-xs font-medium text-slate-400 px-4 py-3">Status</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filtered.map(student => {
              const progress = progressMap[student.uid]
              const cohort   = cohorts.find(c => c.id === student.cohortId)
              return (
                <tr key={student.uid} className="hover:bg-slate-700/50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar uid={student.uid} name={student.displayName} avatarUrl={student.avatarUrl} size="sm" />
                      <div>
                        <p className="text-sm font-medium text-white">{student.displayName}</p>
                        <p className="text-xs text-slate-400">{student.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-300">{cohort?.name ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <XPBar
                      current={progress?.completedAssignments ?? 0}
                      max={progress?.totalAssignments ?? 1}
                      color="bg-brand-500"
                    />
                    <p className="text-xs text-slate-500 mt-0.5">{progress?.overallPercentage ?? 0}%</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-semibold text-amber-400">{student.totalPoints}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {student.isActive
                      ? <span className="badge badge-green"><UserCheck className="w-3 h-3" /> Active</span>
                      : <span className="badge badge-rose"><UserX className="w-3 h-3" /> Inactive</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/teacher/students/${student.uid}`} className="p-1.5 text-slate-500 hover:text-white transition-colors block">
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-12">No students found.</p>
        )}
      </div>
    </div>
  )
}
