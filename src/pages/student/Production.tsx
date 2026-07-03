import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { ProductionTeamDoc, UserDoc, ProductionDoc, ProductionPeriodDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { cn } from '@/lib/utils'
import { Plus, Film, Clock, Globe, Lock, X, Users, CalendarRange } from 'lucide-react'
import StudentProductionPeriod from '@/pages/student/ProductionPeriod'

function relTime(ts: any): string {
  if (!ts?.toDate) return ''
  const diff = (Date.now() - ts.toDate().getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function StudentProduction() {
  const { profile, cohortId: ctxCohortId, previewCohortId } = useAuth()
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? null
  const navigate = useNavigate()
  const [showNew,         setShowNew]         = useState(false)
  const [newTitle,        setNewTitle]        = useState('')
  const [creating,        setCreating]        = useState(false)
  const [prodTab,         setProdTab]         = useState<'crew' | 'period' | 'productions'>('crew')
  const [productionType,  setProductionType]  = useState<'period' | 'side'>('period')
  const [selectedPeriodId,setSelectedPeriodId] = useState('')

  const { data: teams, loading: teamsLoading } = useCollection<ProductionTeamDoc>(
    'production_teams',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )

  const { data: allUsers } = useCollection<UserDoc>('users')

  const { data: productions, loading: prodsLoading } = useCollection<ProductionDoc>(
    'productions',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )

  const { data: periods } = useCollection<ProductionPeriodDoc>(
    'production_periods',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
  )

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

  const teamMemberIds = useMemo(() => myTeam?.memberIds ?? [], [myTeam])

  // Productions sorted by last updated
  const sortedProds = useMemo(
    () => [...productions].sort((a, b) => {
      const ta = (a.updatedAt ?? a.createdAt)?.toMillis?.() ?? 0
      const tb = (b.updatedAt ?? b.createdAt)?.toMillis?.() ?? 0
      return tb - ta
    }),
    [productions],
  )

  const myProductions = useMemo(
    () => sortedProds.filter(p =>
      p.createdBy === profile?.uid ||
      p.collaborators?.includes(profile?.uid ?? ''),
    ),
    [sortedProds, profile],
  )

  // Productions by other team members (not mine)
  const teamProductions = useMemo(
    () => sortedProds.filter(p => {
      const uid = profile?.uid ?? ''
      return teamMemberIds.includes(p.createdBy) &&
        p.createdBy !== uid &&
        !p.collaborators?.includes(uid)
    }),
    [sortedProds, profile, teamMemberIds],
  )

  async function createProduction() {
    if (!newTitle.trim() || !profile || !cohortId) return
    setCreating(true)
    const linkedPeriod = productionType === 'period' && selectedPeriodId
      ? periods.find(p => p.id === selectedPeriodId) ?? null
      : null
    try {
      const ref = await addDoc(collection(db, 'productions'), {
        title: newTitle.trim(),
        cohortId,
        createdBy: profile.uid,
        collaborators: [],
        viewerIds: [],
        sharedTeams: [],
        isPublic: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastEditedBy: profile.uid,
        productionType,
        productionPeriodId: linkedPeriod?.id ?? null,
        periodId: linkedPeriod?.id ?? null,
        ...(linkedPeriod?.budgetPerProduction != null ? { budgetLimit: linkedPeriod.budgetPerProduction } : {}),
      })
      setShowNew(false)
      setNewTitle('')
      navigate(`/production/planning/${ref.id}`)
    } finally {
      setCreating(false)
    }
  }

  if (teamsLoading || prodsLoading) return <LoadingSpinner />

  const sortedCommandments = myTeam ? [...myTeam.commandments].sort((a, b) => a.order - b.order) : []

  function ProductionCard({ prod }: { prod: ProductionDoc }) {
    return (
      <button
        onClick={() => navigate(`/production/planning/${prod.id}`)}
        className="w-full text-left bg-zinc-900 border border-white/10 rounded-2xl p-4 hover:border-brand-500/40 hover:bg-zinc-800/80 transition-all group"
      >
        <div className="flex items-start gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-brand-600/20 flex items-center justify-center text-lg flex-shrink-0">🎬</div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-zinc-100 truncate group-hover:text-brand-400 transition-colors text-sm">{prod.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {prod.isPublic
                ? <span className="text-[10px] text-emerald-500 flex items-center gap-0.5"><Globe className="w-2.5 h-2.5" />Shared</span>
                : <span className="text-[10px] text-zinc-600 flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" />Private</span>
              }
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <Clock className="w-3 h-3" />
          {relTime(prod.updatedAt ?? prod.createdAt)}
          {prod.createdBy !== profile?.uid && (
            <span className="ml-1 text-zinc-600">by {userMap[prod.createdBy]?.displayName ?? '?'}</span>
          )}
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Production</h1>
        <p className="text-zinc-500 text-sm mt-1">Your production team and planning.</p>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 bg-zinc-900 rounded-xl border border-white/10 w-fit">
        <button onClick={() => setProdTab('crew')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${prodTab === 'crew' ? 'bg-brand-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <Users className="w-4 h-4" /> Crew
        </button>
        <button onClick={() => setProdTab('period')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${prodTab === 'period' ? 'bg-brand-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <CalendarRange className="w-4 h-4" /> Period
        </button>
        <button onClick={() => setProdTab('productions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${prodTab === 'productions' ? 'bg-brand-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <Film className="w-4 h-4" /> Productions
        </button>
      </div>

      {prodTab === 'crew' && !myTeam && (
        <div className="card text-center py-16">
          <p className="text-5xl mb-4">🎬</p>
          <h2 className="text-xl font-bold text-white mb-2">No productions yet</h2>
          <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
            Create your first production to start planning your film, or wait for your teacher to add you to a crew.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={() => setShowNew(true)}
              className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm"
            >
              + Create Production
            </button>
            <a href="/guide" className="bg-white/10 hover:bg-white/15 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm">
              Read the guide
            </a>
          </div>
        </div>
      )}
      {prodTab === 'crew' && myTeam && (
        <>
          {/* ── Team hero card ──────────────────────────────────────── */}
          <div className="rounded-2xl overflow-hidden shadow-lg">
            <div className="h-24 flex items-center justify-center gap-4" style={{ backgroundColor: myTeam.color }}>
              <span className="text-5xl drop-shadow-md">{myTeam.emoji}</span>
              <h2 className="text-3xl font-black text-white drop-shadow-md tracking-tight">{myTeam.name}</h2>
            </div>
            <div className="bg-zinc-900 px-6 py-5">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4">Crew members</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
                {myTeam.memberIds.map(uid => {
                  const user = userMap[uid]
                  if (!user) return null
                  return (
                    <div key={uid} className="flex flex-col items-center gap-2 text-center">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.displayName}
                          className="w-20 h-20 rounded-full object-cover ring-4 ring-white shadow-md" />
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
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── Daily commandment ───────────────────────────────────── */}
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

          {/* ── All commandments ────────────────────────────────────── */}
          {sortedCommandments.length > 0 && (
            <div>
              <h3 className="section-title mb-4">
                <span className="mr-2">{myTeam.emoji}</span> The {myTeam.name} Commandments
              </h3>
              <div className="space-y-3">
                {sortedCommandments.map((cmd, i) => (
                  <div
                    key={cmd.id}
                    className="flex items-start gap-4 bg-zinc-900 rounded-2xl px-5 py-4 shadow-sm border border-white/10"
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
        </>
      )}

      {prodTab === 'period' && <StudentProductionPeriod embedded />}

      {/* ── Productions tab ─────────────────────────────────────────── */}
      {prodTab === 'productions' && <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title flex items-center gap-2">
            <Film className="w-4 h-4 text-brand-500" /> Productions
          </h2>
          <button
            onClick={() => setShowNew(true)}
            className="btn-primary flex items-center gap-1.5 py-2 px-4 text-sm"
          >
            <Plus className="w-4 h-4" /> New
          </button>
        </div>

        {/* My productions */}
        {myProductions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Mine</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {myProductions.map(p => <ProductionCard key={p.id} prod={p} />)}
            </div>
          </div>
        )}

        {/* Team productions */}
        {teamProductions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {myTeam ? `${myTeam.name} crew` : 'Team'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {teamProductions.map(p => <ProductionCard key={p.id} prod={p} />)}
            </div>
          </div>
        )}

        {myProductions.length === 0 && teamProductions.length === 0 && (
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-10 text-center">
            <span className="text-4xl block mb-3">🎬</span>
            <p className="text-zinc-400 text-sm">No productions yet — start planning your film!</p>
            <button onClick={() => setShowNew(true)} className="mt-4 btn-primary py-2 px-5 text-sm">
              Create First Production
            </button>
          </div>
        )}
      </div>}

      {/* ── New production modal ─────────────────────────────────────── */}
      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false) }}
        >
          <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">New Production</h2>
              <button onClick={() => setShowNew(false)} className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="label">Production title</label>
              <input
                autoFocus
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createProduction()}
                className="input w-full"
                placeholder="e.g. The Last Frame"
              />
            </div>
            <div>
              <label className="label">Type</label>
              <div className="flex gap-2">
                {(['period', 'side'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setProductionType(t)}
                    className={cn(
                      'flex-1 py-2 px-3 rounded-xl text-sm font-medium border transition-colors',
                      productionType === t
                        ? 'bg-brand-600 border-brand-500 text-white'
                        : 'bg-zinc-800 border-white/10 text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    {t === 'period' ? '📅 Period production' : '✨ Side project'}
                  </button>
                ))}
              </div>
            </div>
            {productionType === 'period' && periods.length > 0 && (
              <div>
                <label className="label">Link to period <span className="text-zinc-500 font-normal">(optional)</span></label>
                <select
                  value={selectedPeriodId}
                  onChange={e => setSelectedPeriodId(e.target.value)}
                  className="input w-full"
                >
                  <option value="">— No period —</option>
                  {periods.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={createProduction}
                disabled={creating || !newTitle.trim()}
                className="btn-primary py-2.5 px-6 flex-1 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create & Open'}
              </button>
              <button onClick={() => setShowNew(false)} className="btn-secondary py-2.5 px-4">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
