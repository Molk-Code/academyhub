import { useState, useMemo, useEffect, useRef } from 'react'
import {
  collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, where, orderBy } from '@/hooks/useFirestore'
import type { CohortDoc, UserDoc, ProductionTeamDoc, Commandment, ChatChannelDoc } from '@/types'
import { Plus, Trash2, Check, X, Pencil, Users, Clapperboard } from 'lucide-react'
import { cn, initials, avatarColor } from '@/lib/utils'
import { nanoid } from 'nanoid'
import Avatar from '@/components/common/Avatar'

const TEAM_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e',
  '#06b6d4','#3b82f6','#6366f1','#8b5cf6',
  '#ec4899','#10b981',
]

const TEAM_EMOJIS = ['🎬','🎥','📽️','🎭','🎞️','🎤','💡','🔊','🎨','✂️','🎙️','📸','🚀','⚡','🔥','💫','🌟','👁️','🎪','🏆']

export default function TeacherProduction() {
  const { profile } = useAuth()
  const { data: cohorts } = useCollection<CohortDoc>('cohorts', [orderBy('name', 'asc')])
  const [cohortId, setCohortId] = useState('')

  const { data: teams } = useCollection<ProductionTeamDoc>(
    'production_teams',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId, cohortId,
  )
  const { data: cohortStudents } = useCollection<UserDoc>(
    'users',
    cohortId ? [where('cohortId', '==', cohortId), where('role', '==', 'student')] : [],
    !!cohortId, cohortId,
  )

  // Load ALL teams (not just the selected cohort) so we can sync channels for every crew
  const { data: allTeams } = useCollection<ProductionTeamDoc>('production_teams')
  const { data: allChannels } = useCollection<ChatChannelDoc>('chat_channels')

  // Auto-create missing channels for every crew that doesn't have one yet
  const syncedTeamIds = useRef(new Set<string>())
  useEffect(() => {
    if (!profile || allTeams.length === 0) return
    for (const team of allTeams) {
      if (syncedTeamIds.current.has(team.id)) continue
      const hasChannel = allChannels.some(ch => (ch.allowedTeamIds ?? []).includes(team.id))
      if (!hasChannel) {
        syncedTeamIds.current.add(team.id)
        addDoc(collection(db, 'chat_channels'), {
          name: `${team.emoji} ${team.name}`,
          description: `Channel for the ${team.name} crew`,
          order: 100 + allChannels.length,
          createdAt: serverTimestamp(),
          createdBy: profile.uid,
          isPublic: false,
          allowedRoles: [],
          allowedCohortIds: [team.cohortId],
          allowedTeamIds: [team.id],
          memberIds: [],
        })
      }
    }
  }, [allTeams, allChannels, profile])

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const selectedTeam = teams.find(t => t.id === selectedTeamId) ?? null

  // ── New / edit team form ────────────────────────────────────────────────────
  const [teamPanel, setTeamPanel] = useState<'new' | null>(null)
  const [teamForm, setTeamForm] = useState({ name: '', emoji: '🎬', color: TEAM_COLORS[0] })
  const [savingTeam, setSavingTeam] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)

  // ── Commandment form ────────────────────────────────────────────────────────
  const [cmdEditing, setCmdEditing] = useState<string | null>(null)
  const [cmdAdding, setCmdAdding] = useState(false)
  const [cmdText, setCmdText] = useState('')
  const [savingCmd, setSavingCmd] = useState(false)

  const assignedIds = useMemo(() => new Set(teams.flatMap(t => t.memberIds)), [teams])

  async function createTeam() {
    if (!teamForm.name.trim() || !cohortId || !profile) return
    setSavingTeam(true)
    setTeamError(null)
    try {
      const teamRef = await addDoc(collection(db, 'production_teams'), {
        cohortId,
        name: teamForm.name.trim(),
        emoji: teamForm.emoji,
        color: teamForm.color,
        memberIds: [],
        commandments: [],
        order: teams.length,
        createdAt: serverTimestamp(),
        createdBy: profile.uid,
      })

      // Auto-create a matching chat channel locked to this crew
      await addDoc(collection(db, 'chat_channels'), {
        name: `${teamForm.emoji} ${teamForm.name.trim()}`,
        description: `Channel for the ${teamForm.name.trim()} crew`,
        order: 100 + teams.length,
        createdAt: serverTimestamp(),
        createdBy: profile.uid,
        isPublic: false,
        allowedRoles: [],
        allowedCohortIds: [cohortId],
        allowedTeamIds: [teamRef.id],
        memberIds: [],
      })

      setTeamPanel(null)
      setTeamForm({ name: '', emoji: '🎬', color: TEAM_COLORS[0] })
      setSelectedTeamId(teamRef.id)
    } catch (e: any) {
      setTeamError(e.message ?? 'Failed to create crew. Check your permissions.')
    } finally {
      setSavingTeam(false)
    }
  }

  async function deleteTeam(id: string) {
    if (!confirm('Delete this crew? All member assignments will be lost.')) return
    if (selectedTeamId === id) setSelectedTeamId(null)
    await deleteDoc(doc(db, 'production_teams', id))
  }

  async function toggleMember(studentId: string) {
    if (!selectedTeam) return
    const already = selectedTeam.memberIds.includes(studentId)
    await updateDoc(doc(db, 'production_teams', selectedTeam.id), {
      memberIds: already
        ? selectedTeam.memberIds.filter(id => id !== studentId)
        : [...selectedTeam.memberIds, studentId],
    })
  }

  async function saveCommandment() {
    if (!selectedTeam || !cmdText.trim()) return
    setSavingCmd(true)
    const cmds = selectedTeam.commandments ?? []
    let updated: Commandment[]
    if (cmdEditing) {
      updated = cmds.map(c => c.id === cmdEditing ? { ...c, text: cmdText.trim() } : c)
    } else {
      updated = [...cmds, { id: nanoid(), text: cmdText.trim(), order: cmds.length }]
    }
    await updateDoc(doc(db, 'production_teams', selectedTeam.id), { commandments: updated })
    setCmdEditing(null)
    setCmdAdding(false)
    setCmdText('')
    setSavingCmd(false)
  }

  async function deleteCommandment(cmdId: string) {
    if (!selectedTeam) return
    await updateDoc(doc(db, 'production_teams', selectedTeam.id), {
      commandments: selectedTeam.commandments.filter(c => c.id !== cmdId),
    })
  }

  const commandments = useMemo(
    () => [...(selectedTeam?.commandments ?? [])].sort((a, b) => a.order - b.order),
    [selectedTeam],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2"><Clapperboard className="w-6 h-6" /> Production</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage production crews and commandments per class.</p>
        </div>
        <select value={cohortId} onChange={e => { setCohortId(e.target.value); setSelectedTeamId(null) }} className="input w-48">
          <option value="">Select class…</option>
          {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!cohortId ? (
        <div className="text-center py-20 text-zinc-400">
          <Clapperboard className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a class to manage production crews.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Team list ─────────────────────────────────────────────────── */}
          <div className="space-y-3">
            {teams.map(team => (
              <button
                key={team.id}
                onClick={() => setSelectedTeamId(selectedTeamId === team.id ? null : team.id)}
                className={cn(
                  'w-full text-left rounded-2xl border p-4 transition-all group',
                  selectedTeamId === team.id
                    ? 'border-brand-300 bg-brand-50 shadow-sm'
                    : 'border-white/10 bg-zinc-900 hover:border-white/15 hover:shadow-sm',
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: team.color + '22', border: `2px solid ${team.color}` }}>
                    {team.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-100 truncate">{team.name}</p>
                    <p className="text-xs text-zinc-400">{team.memberIds.length} members · {team.commandments.length} commandments</p>
                  </div>
                  <button
                    onMouseDown={e => { e.stopPropagation(); deleteTeam(team.id) }}
                    className="p-1.5 text-zinc-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </button>
            ))}

            {teamPanel === 'new' ? (
              <div className="bg-zinc-900 rounded-2xl border border-brand-200 p-4 space-y-3">
                {teamError && (
                  <p className="text-xs text-rose-400 bg-rose-950/40 rounded-lg px-3 py-2">{teamError}</p>
                )}
                <input
                  autoFocus
                  className="input py-2 text-sm"
                  placeholder="Crew name…"
                  value={teamForm.name}
                  onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && createTeam()}
                />
                {/* Emoji picker */}
                <div>
                  <p className="text-xs text-zinc-400 mb-1.5">Icon</p>
                  <div className="flex flex-wrap gap-1">
                    {TEAM_EMOJIS.map(em => (
                      <button key={em} type="button" onClick={() => setTeamForm(f => ({ ...f, emoji: em }))}
                        className={cn('w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-all', teamForm.emoji === em ? 'bg-brand-100 ring-2 ring-brand-400' : 'hover:bg-zinc-800')}>
                        {em}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Color picker */}
                <div>
                  <p className="text-xs text-zinc-400 mb-1.5">Color</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TEAM_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setTeamForm(f => ({ ...f, color: c }))}
                        className={cn('w-6 h-6 rounded-full transition-all', teamForm.color === c ? 'ring-2 ring-offset-2 ring-slate-500 scale-110' : '')}
                        style={{ background: c }} />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={createTeam} disabled={savingTeam || !teamForm.name.trim()} className="btn-primary py-1.5 text-xs">
                    <Check className="w-3.5 h-3.5" /> Create
                  </button>
                  <button onClick={() => setTeamPanel(null)} className="btn-secondary py-1.5 text-xs"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setTeamPanel('new'); setTeamError(null) }} className="w-full rounded-2xl border-2 border-dashed border-white/10 p-4 text-sm text-zinc-400 hover:border-brand-300 hover:text-brand-600 transition-all flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" /> New crew
              </button>
            )}
          </div>

          {/* ── Team detail ───────────────────────────────────────────────── */}
          {selectedTeam ? (
            <div className="lg:col-span-2 space-y-5">
              {/* Team header */}
              <div className="rounded-2xl p-5 text-white" style={{ background: selectedTeam.color }}>
                <div className="flex items-center gap-4">
                  <span className="text-4xl">{selectedTeam.emoji}</span>
                  <div>
                    <h2 className="text-xl font-bold">{selectedTeam.name}</h2>
                    <p className="text-white/70 text-sm">{selectedTeam.memberIds.length} members</p>
                  </div>
                </div>
              </div>

              {/* Members */}
              <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-white/8">
                  <Users className="w-4 h-4 text-zinc-400" />
                  <h3 className="font-semibold text-zinc-100">Members</h3>
                  <span className="text-xs text-zinc-400 ml-auto">Click a student to add/remove</span>
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {cohortStudents.map(student => {
                    const inThisTeam = selectedTeam.memberIds.includes(student.id)
                    const inOtherTeam = !inThisTeam && assignedIds.has(student.id)
                    return (
                      <button
                        key={student.id}
                        onClick={() => !inOtherTeam && toggleMember(student.id)}
                        disabled={inOtherTeam}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-all text-left',
                          inThisTeam
                            ? 'border-2 text-white'
                            : inOtherTeam
                              ? 'border-white/8 bg-zinc-900/50 text-zinc-300 cursor-not-allowed'
                              : 'border-white/10 text-zinc-300 hover:border-white/15 hover:bg-white/5',
                        )}
                        style={inThisTeam ? { background: selectedTeam.color, borderColor: selectedTeam.color } : {}}
                      >
                        <Avatar uid={student.id} name={student.displayName} avatarUrl={student.avatarUrl} size="xs" />
                        <span className="truncate">{student.displayName}</span>
                      </button>
                    )
                  })}
                  {cohortStudents.length === 0 && (
                    <p className="col-span-3 text-xs text-zinc-400 py-2 text-center">No students in this class yet.</p>
                  )}
                </div>
              </div>

              {/* Commandments */}
              <div className="bg-zinc-900 rounded-2xl border border-white/10 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
                  <h3 className="font-semibold text-zinc-100">Commandments</h3>
                  {!cmdAdding && !cmdEditing && (
                    <button onClick={() => { setCmdAdding(true); setCmdText('') }} className="btn-secondary py-1.5 text-xs gap-1.5">
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  )}
                </div>

                {cmdAdding && (
                  <div className="px-5 py-3 bg-zinc-900/50 border-b border-white/8 flex items-center gap-2">
                    <input
                      autoFocus
                      className="input py-2 text-sm flex-1"
                      value={cmdText}
                      onChange={e => setCmdText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveCommandment()}
                      placeholder="Write the commandment…"
                    />
                    <button onClick={saveCommandment} disabled={savingCmd || !cmdText.trim()} className="p-2 text-emerald-500 hover:text-emerald-600 transition-colors"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setCmdAdding(false)} className="p-2 text-zinc-400 hover:text-zinc-400 transition-colors"><X className="w-4 h-4" /></button>
                  </div>
                )}

                <ul className="divide-y divide-slate-100">
                  {commandments.map((cmd, i) => (
                    <li key={cmd.id} className="flex items-start gap-3 px-5 py-3 group hover:bg-white/5 transition-colors">
                      <span className="text-lg font-bold flex-shrink-0 mt-0.5" style={{ color: selectedTeam.color }}>
                        {(i + 1).toString().padStart(2, '0')}
                      </span>
                      {cmdEditing === cmd.id ? (
                        <>
                          <input autoFocus className="input py-1.5 text-sm flex-1" value={cmdText} onChange={e => setCmdText(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveCommandment()} />
                          <button onClick={saveCommandment} className="p-1.5 text-emerald-500 hover:text-emerald-600 transition-colors"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setCmdEditing(null)} className="p-1.5 text-zinc-400 hover:text-zinc-400 transition-colors"><X className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-zinc-200 pt-0.5">{cmd.text}</span>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setCmdEditing(cmd.id); setCmdText(cmd.text); setCmdAdding(false) }} className="p-1.5 text-zinc-400 hover:text-zinc-300 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => deleteCommandment(cmd.id)} className="p-1.5 text-zinc-400 hover:text-rose-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                  {commandments.length === 0 && !cmdAdding && (
                    <li className="px-5 py-6 text-sm text-zinc-400 text-center">No commandments yet — add your first one above.</li>
                  )}
                </ul>
              </div>
            </div>
          ) : (
            <div className="lg:col-span-2 flex items-center justify-center rounded-2xl border-2 border-dashed border-white/10 py-20">
              <p className="text-zinc-400 text-sm">Select a team to edit it.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
