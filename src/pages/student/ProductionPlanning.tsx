import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where } from '@/hooks/useFirestore'
import type { ProductionDoc } from '@/types'
import { Plus, Film, Clock, Users, Lock, Globe, X } from 'lucide-react'
import LoadingSpinner from '@/components/common/LoadingSpinner'

function relTime(ts: any): string {
  if (!ts?.toDate) return ''
  const diff = (Date.now() - ts.toDate().getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function ProductionCard({ prod, onClick }: { prod: ProductionDoc; onClick: () => void }) {
  const totalAccess = 1 + (prod.collaborators?.length ?? 0) + (prod.viewerIds?.length ?? 0)
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-zinc-900 border border-white/10 rounded-2xl p-5 hover:border-brand-500/40 hover:bg-zinc-800/80 transition-all group"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-brand-600/20 flex items-center justify-center text-xl flex-shrink-0">🎬</div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-zinc-100 truncate group-hover:text-brand-400 transition-colors">{prod.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {prod.isPublic
              ? <span className="text-xs text-emerald-500 flex items-center gap-1"><Globe className="w-3 h-3" />Shared</span>
              : <span className="text-xs text-zinc-600 flex items-center gap-1"><Lock className="w-3 h-3" />Private</span>
            }
            {prod.sharedTeams?.length > 0 && (
              <span className="text-xs text-amber-500">{prod.sharedTeams.map(t => t.teamName).join(', ')}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{relTime(prod.updatedAt ?? prod.createdAt)}</span>
        {totalAccess > 1 && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{totalAccess} people</span>}
      </div>
    </button>
  )
}

export default function ProductionPlanning() {
  const { profile, cohortId: ctxCohortId, previewCohortId } = useAuth()
  const cohortId = ctxCohortId ?? previewCohortId ?? profile?.cohortId ?? null
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  // No orderBy to avoid composite index requirement — sort client-side
  const { data: productions, loading } = useCollection<ProductionDoc>(
    'productions',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId,
    cohortId ?? '',
  )

  const sorted = useMemo(
    () => [...productions].sort((a, b) => {
      const ta = (a.updatedAt ?? a.createdAt)?.toMillis?.() ?? 0
      const tb = (b.updatedAt ?? b.createdAt)?.toMillis?.() ?? 0
      return tb - ta
    }),
    [productions],
  )

  const myProductions = useMemo(
    () => sorted.filter(p =>
      p.createdBy === profile?.uid ||
      p.collaborators?.includes(profile?.uid ?? '')
    ),
    [sorted, profile],
  )

  const publicOthers = useMemo(
    () => sorted.filter(p => {
      const uid = profile?.uid ?? ''
      return p.isPublic && p.createdBy !== uid && !p.collaborators?.includes(uid)
    }),
    [sorted, profile],
  )

  const sharedWithMe = useMemo(
    () => sorted.filter(p => {
      const uid = profile?.uid ?? ''
      return (p.viewerIds?.includes(uid)) &&
        p.createdBy !== uid && !p.collaborators?.includes(uid)
    }),
    [sorted, profile],
  )

  async function createProduction() {
    if (!newTitle.trim() || !profile || !cohortId) return
    setCreating(true)
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
      })
      setShowNew(false)
      setNewTitle('')
      navigate(`/production/planning/${ref.id}`)
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <LoadingSpinner />

  const Section = ({ title, items }: { title: string; items: ProductionDoc[] }) =>
    items.length === 0 ? null : (
      <div className="space-y-3">
        <h2 className="section-title">{title}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(p => (
            <ProductionCard key={p.id} prod={p} onClick={() => navigate(`/production/planning/${p.id}`)} />
          ))}
        </div>
      </div>
    )

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Film className="w-6 h-6 text-brand-500" /> Production Planning
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Script breakdowns, shot lists, cast and schedules.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 py-2.5 px-5">
          <Plus className="w-4 h-4" /> New Production
        </button>
      </div>

      {myProductions.length === 0 && sharedWithMe.length === 0 && publicOthers.length === 0 ? (
        <div className="bg-zinc-900 border border-white/10 rounded-2xl p-10 text-center">
          <span className="text-4xl block mb-3">🎬</span>
          <p className="text-zinc-400 text-sm">No productions yet — start planning your film!</p>
          <button onClick={() => setShowNew(true)} className="mt-4 btn-primary py-2 px-5 text-sm">
            Create First Production
          </button>
        </div>
      ) : (
        <>
          <Section title="My Productions" items={myProductions} />
          <Section title="Shared With Me" items={sharedWithMe} />
          <Section title="All Productions" items={publicOthers} />
        </>
      )}

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
