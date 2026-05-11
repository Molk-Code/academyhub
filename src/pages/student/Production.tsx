import { useMemo } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { ProductionTeamDoc, UserDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

export default function StudentProduction() {
  const { profile, cohortId } = useAuth()

  const { data: teams, loading } = useCollection<ProductionTeamDoc>(
    'production_teams',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )

  const { data: allUsers } = useCollection<UserDoc>('users')

  const myTeam = useMemo(
    () => teams.find(t => profile && t.memberIds.includes(profile.uid)) ?? null,
    [teams, profile],
  )

  const userMap = useMemo(
    () => Object.fromEntries(allUsers.map(u => [u.id, u])),
    [allUsers],
  )

  const dailyCommandment = useMemo(() => {
    if (!myTeam || myTeam.commandments.length === 0) return null
    const sorted = [...myTeam.commandments].sort((a, b) => a.order - b.order)
    const idx = Math.floor(Date.now() / 86400000) % sorted.length
    return sorted[idx]
  }, [myTeam])

  if (loading) return <LoadingSpinner />

  if (!myTeam) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Production</h1>
          <p className="text-zinc-500 text-sm mt-1">Your production team and commandments.</p>
        </div>
        <div className="card flex flex-col items-center justify-center py-16 text-center gap-3">
          <span className="text-5xl">🎬</span>
          <p className="text-zinc-300 font-semibold text-lg">You're not in a crew yet</p>
          <p className="text-zinc-400 text-sm">Ask your teacher to add you to a production crew.</p>
        </div>
      </div>
    )
  }

  const members = myTeam.memberIds.map(uid => userMap[uid]).filter(Boolean)
  const sortedCommandments = [...myTeam.commandments].sort((a, b) => a.order - b.order)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Production</h1>
        <p className="text-zinc-500 text-sm mt-1">Your production team and commandments.</p>
      </div>

      {/* Team hero card */}
      <div className="rounded-2xl overflow-hidden shadow-lg">
        <div className="h-24 flex items-center justify-center gap-4" style={{ backgroundColor: myTeam.color }}>
          <span className="text-5xl drop-shadow-md">{myTeam.emoji}</span>
          <h2 className="text-3xl font-black text-white drop-shadow-md tracking-tight">{myTeam.name}</h2>
        </div>
        <div className="bg-zinc-900 px-6 py-5">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4">Crew members</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
            {members.map(user => (
              <div key={user.id} className="flex flex-col items-center gap-2 text-center">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.displayName}
                    className="w-20 h-20 rounded-full object-cover ring-4 ring-white shadow-md"
                  />
                ) : (
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-md"
                    style={{ backgroundColor: myTeam.color }}
                  >
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <p className="text-sm font-semibold text-zinc-200 leading-tight">{user.displayName}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Daily commandment highlight */}
      {dailyCommandment && (
        <div
          className="rounded-2xl p-6 text-white shadow-xl"
          style={{ background: `linear-gradient(135deg, ${myTeam.color}dd, ${myTeam.color})` }}
        >
          <p className="text-xs font-bold uppercase tracking-widest opacity-75 mb-2">Today's Commandment</p>
          <div className="flex items-start gap-3">
            <span className="text-4xl font-black opacity-30 leading-none mt-1">
              {String(sortedCommandments.indexOf(dailyCommandment) + 1).padStart(2, '0')}
            </span>
            <p className="text-xl font-bold leading-snug">{dailyCommandment.text}</p>
          </div>
        </div>
      )}

      {/* All commandments */}
      {sortedCommandments.length > 0 && (
        <div>
          <h3 className="section-title mb-4">
            <span className="mr-2">{myTeam.emoji}</span> The {myTeam.name} Commandments
          </h3>
          <div className="space-y-3">
            {sortedCommandments.map((cmd, i) => (
              <div
                key={cmd.id}
                className="flex items-start gap-4 bg-zinc-900 rounded-2xl px-5 py-4 shadow-sm border border-white/8"
              >
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black text-white flex-shrink-0 shadow-sm"
                  style={{ backgroundColor: myTeam.color }}
                >
                  {i + 1}
                </span>
                <p className="text-zinc-200 font-medium leading-relaxed pt-1.5">{cmd.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
