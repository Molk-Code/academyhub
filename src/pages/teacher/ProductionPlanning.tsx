import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { ProductionDoc, UserDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { Film, Clock, Globe, Lock, Users } from 'lucide-react'

function relTime(ts: any): string {
  if (!ts?.toDate) return ''
  const diff = (Date.now() - ts.toDate().getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function TeacherProductionPlanning() {
  const { profile, cohortId: ctxCohortId } = useAuth()
  const navigate = useNavigate()

  const { data: allUsers } = useCollection<UserDoc>('users')

  // Fetch all productions (no cohort filter for teachers — see all)
  const { data: productions, loading } = useCollection<ProductionDoc>('productions')

  const userMap = useMemo(
    () => Object.fromEntries(allUsers.map(u => [u.id, u])),
    [allUsers],
  )

  const sorted = useMemo(
    () => [...productions].sort((a, b) => {
      const ta = (a.updatedAt ?? a.createdAt)?.toMillis?.() ?? 0
      const tb = (b.updatedAt ?? b.createdAt)?.toMillis?.() ?? 0
      return tb - ta
    }),
    [productions],
  )

  // Group by cohort for display
  const byCohort = useMemo(() => {
    const map: Record<string, ProductionDoc[]> = {}
    sorted.forEach(p => {
      const key = p.cohortId ?? 'unknown'
      if (!map[key]) map[key] = []
      map[key].push(p)
    })
    return map
  }, [sorted])

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Film className="w-5 h-5 text-brand-500" /> Student Productions
        </h1>
        <p className="text-zinc-500 text-sm mt-1">View and give feedback on all student production plans.</p>
      </div>

      {sorted.length === 0 && (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-12 text-center text-zinc-500">
          <span className="text-4xl block mb-3">🎬</span>
          <p className="text-sm">No student productions yet.</p>
        </div>
      )}

      {Object.entries(byCohort).map(([cohortId, prods]) => (
        <div key={cohortId} className="space-y-3">
          <h2 className="section-title flex items-center gap-2">
            <Users className="w-4 h-4 text-zinc-400" />
            <span className="text-zinc-400 text-xs font-mono">{cohortId}</span>
            <span className="text-xs text-zinc-600 font-normal">{prods.length} production{prods.length !== 1 ? 's' : ''}</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {prods.map(prod => {
              const creator = userMap[prod.createdBy]
              const collabCount = (prod.collaborators ?? []).length
              return (
                <button
                  key={prod.id}
                  onClick={() => navigate(`/teacher/production/planning/${prod.id}`)}
                  className="w-full text-left bg-zinc-900 border border-white/10 rounded-2xl p-4 hover:border-brand-500/40 hover:bg-zinc-800/80 transition-all group"
                >
                  <div className="flex items-start gap-3 mb-2">
                    <div className="w-9 h-9 rounded-xl bg-brand-600/20 flex items-center justify-center text-lg flex-shrink-0">🎬</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-zinc-100 truncate group-hover:text-brand-400 transition-colors text-sm">{prod.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {prod.isPublic
                          ? <span className="text-[10px] text-emerald-500 flex items-center gap-0.5"><Globe className="w-2.5 h-2.5" />Shared</span>
                          : <span className="text-[10px] text-zinc-600 flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" />Private</span>
                        }
                        {creator && <span className="text-[10px] text-zinc-500">by {creator.displayName}</span>}
                        {collabCount > 0 && <span className="text-[10px] text-zinc-600">+{collabCount} editor{collabCount !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                    <Clock className="w-3 h-3" />
                    {relTime(prod.updatedAt ?? prod.createdAt)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
