import { useState } from 'react'
import {
  collection, deleteDoc, doc, updateDoc, getDocs, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { ChatChannelDoc, CohortDoc, UserDoc, UserRole, ProductionTeamDoc } from '@/types'
import {
  Hash, Plus, Trash2, X, Lock, Globe, UserPlus, ChevronDown, ChevronUp,
} from 'lucide-react'
import Avatar from '@/components/common/Avatar'
import { cn } from '@/lib/utils'

export function ChannelSettingsModal({
  channel,
  onClose,
  onDeleted,
}: {
  channel: ChatChannelDoc
  onClose: () => void
  onDeleted: () => void
}) {
  const [name,              setName]              = useState(channel.name)
  const [desc,              setDesc]              = useState(channel.description ?? '')
  const [isPublic,          setIsPublic]          = useState(channel.isPublic !== false)
  const [allowedRoles,      setAllowedRoles]      = useState<UserRole[]>(channel.allowedRoles ?? [])
  const [allowedCohortIds,  setAllowedCohortIds]  = useState<string[]>(channel.allowedCohortIds ?? [])
  const [allowedTeamIds,    setAllowedTeamIds]    = useState<string[]>(channel.allowedTeamIds ?? [])
  const [memberIds,         setMemberIds]         = useState<string[]>(channel.memberIds ?? [])
  const [saving,            setSaving]            = useState(false)
  const [deleting,          setDeleting]          = useState(false)
  const [clearing,          setClearing]          = useState(false)
  const [memberSearch,      setMemberSearch]      = useState('')
  const [showAddList,       setShowAddList]       = useState(false)

  const { data: allUsers }   = useCollection<UserDoc>('users', [orderBy('displayName', 'asc')])
  const { data: allCohorts } = useCollection<CohortDoc>('cohorts', [orderBy('name', 'asc')])
  const { data: allTeams }   = useCollection<ProductionTeamDoc>('production_teams')

  const nonAdminUsers = allUsers.filter(u => {
    const userRoles = u.roles?.length ? u.roles : [u.role]
    return !userRoles.includes('admin')
  })

  const currentMembers = nonAdminUsers.filter(u => memberIds.includes(u.uid))
  const addableUsers   = nonAdminUsers.filter(u =>
    !memberIds.includes(u.uid) &&
    (!memberSearch || u.displayName.toLowerCase().includes(memberSearch.toLowerCase())),
  )

  function toggleRole(role: UserRole) {
    setAllowedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role],
    )
  }

  function addMember(uid: string) {
    setMemberIds(prev => [...prev, uid])
    setMemberSearch('')
  }

  function removeMember(uid: string) {
    setMemberIds(prev => prev.filter(id => id !== uid))
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'chat_channels', channel.id), {
        name:             name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        description:      desc.trim(),
        isPublic,
        allowedRoles:     isPublic ? [] : allowedRoles,
        allowedCohortIds: isPublic ? [] : allowedCohortIds,
        allowedTeamIds:   isPublic ? [] : allowedTeamIds,
        memberIds:        isPublic ? [] : memberIds,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (!confirm(`Clear all messages in #${channel.name}? This cannot be undone.`)) return
    setClearing(true)
    try {
      const snap = await getDocs(collection(db, 'chat_channels', channel.id, 'messages'))
      for (let i = 0; i < snap.docs.length; i += 500) {
        const batch = writeBatch(db)
        snap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      await updateDoc(doc(db, 'chat_channels', channel.id), { lastMessageAt: null })
    } finally {
      setClearing(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete #${channel.name}? All messages will be permanently lost.`)) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'chat_channels', channel.id))
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl border border-white/10 w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <h2 className="text-lg font-semibold text-zinc-100">Channel settings</h2>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Info */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Info</h3>
            <div>
              <label className="label">Channel name</label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="input pl-9"
                  placeholder="channel-name"
                />
              </div>
            </div>
            <div>
              <label className="label">Description <span className="text-zinc-400 font-normal">(optional)</span></label>
              <input
                value={desc}
                onChange={e => setDesc(e.target.value)}
                className="input"
                placeholder="What's this channel about?"
              />
            </div>
          </div>

          {/* Access */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Access</h3>

            <div className="flex gap-2">
              <button
                onClick={() => setIsPublic(true)}
                className={cn(
                  'flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all',
                  isPublic
                    ? 'bg-brand-50 border-brand-200 text-brand-700'
                    : 'border-white/10 text-zinc-500 hover:border-white/15',
                )}
              >
                <Globe className="w-4 h-4 flex-shrink-0" />
                <div className="text-left">
                  <p className="font-semibold leading-tight">Public</p>
                  <p className="text-xs opacity-70 leading-tight mt-0.5">All users can access</p>
                </div>
              </button>
              <button
                onClick={() => setIsPublic(false)}
                className={cn(
                  'flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all',
                  !isPublic
                    ? 'bg-brand-50 border-brand-200 text-brand-700'
                    : 'border-white/10 text-zinc-500 hover:border-white/15',
                )}
              >
                <Lock className="w-4 h-4 flex-shrink-0" />
                <div className="text-left">
                  <p className="font-semibold leading-tight">Restricted</p>
                  <p className="text-xs opacity-70 leading-tight mt-0.5">Control who can access</p>
                </div>
              </button>
            </div>

            {!isPublic && (
              <div className="space-y-4 pl-1">
                {/* Role toggles */}
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-zinc-500 mb-2">Roles with access</p>
                    <div className="flex gap-2">
                      {(['student', 'teacher'] as UserRole[]).map(role => (
                        <button
                          key={role}
                          onClick={() => toggleRole(role)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all capitalize',
                            allowedRoles.includes(role)
                              ? 'bg-brand-600 border-brand-600 text-white'
                              : 'border-white/10 text-zinc-500 hover:border-white/15',
                          )}
                        >
                          {role}s
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1.5">All admins always have access.</p>
                  </div>

                  {/* Cohort picker — shown when students role is toggled */}
                  {allowedRoles.includes('student') && allCohorts.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500 mb-2">
                        Classes with access
                        <span className="text-zinc-400 font-normal ml-1">(leave empty = all students)</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {allCohorts.map(cohort => {
                          const selected = allowedCohortIds.includes(cohort.id)
                          return (
                            <button
                              key={cohort.id}
                              onClick={() => setAllowedCohortIds(prev =>
                                selected ? prev.filter(id => id !== cohort.id) : [...prev, cohort.id],
                              )}
                              className={cn(
                                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
                                selected
                                  ? 'bg-brand-600 border-brand-600 text-white'
                                  : 'border-white/10 text-zinc-500 hover:border-white/15',
                              )}
                            >
                              {cohort.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Team picker */}
                  {allTeams.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500 mb-2">
                        Production teams with access
                        <span className="text-zinc-400 font-normal ml-1">(leave empty = no team filter)</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {allTeams.map(team => {
                          const selected = allowedTeamIds.includes(team.id)
                          return (
                            <button
                              key={team.id}
                              onClick={() => setAllowedTeamIds(prev =>
                                selected ? prev.filter(id => id !== team.id) : [...prev, team.id],
                              )}
                              className={cn(
                                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
                                selected
                                  ? 'text-white border-transparent'
                                  : 'border-white/10 text-zinc-500 hover:border-white/15',
                              )}
                              style={selected ? { backgroundColor: team.color, borderColor: team.color } : {}}
                            >
                              {team.emoji} {team.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Current members */}
                <div>
                  <p className="text-xs font-medium text-zinc-500 mb-2">
                    Individual members
                    {currentMembers.length > 0 && <span className="ml-1 text-zinc-400">({currentMembers.length})</span>}
                  </p>
                  {currentMembers.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {currentMembers.map(u => (
                        <div key={u.uid} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 group">
                          <Avatar uid={u.uid} name={u.displayName} avatarUrl={u.avatarUrl} size="sm" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-200 truncate">{u.displayName}</p>
                            <p className="text-xs text-zinc-400 capitalize">{u.role}</p>
                          </div>
                          <button
                            onClick={() => removeMember(u.uid)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-rose-500 rounded transition-all"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add members */}
                  <button
                    onClick={() => setShowAddList(v => !v)}
                    className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add members
                    {showAddList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {showAddList && (
                    <div className="mt-2 border border-white/10 rounded-xl overflow-hidden">
                      <div className="p-2 border-b border-white/8">
                        <input
                          value={memberSearch}
                          onChange={e => setMemberSearch(e.target.value)}
                          placeholder="Search users…"
                          className="w-full text-sm bg-zinc-900/50 rounded-lg px-3 py-1.5 outline-none placeholder-slate-400"
                        />
                      </div>
                      <div className="max-h-44 overflow-y-auto">
                        {addableUsers.length === 0 ? (
                          <p className="text-xs text-zinc-400 text-center py-4">
                            {memberSearch ? 'No users match' : 'All users already added'}
                          </p>
                        ) : (
                          addableUsers.map(u => (
                            <button
                              key={u.uid}
                              onClick={() => addMember(u.uid)}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 text-left transition-colors"
                            >
                              <Avatar uid={u.uid} name={u.displayName} avatarUrl={u.avatarUrl} size="sm" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-zinc-200 truncate">{u.displayName}</p>
                                <p className="text-xs text-zinc-400 capitalize">{u.role}</p>
                              </div>
                              <Plus className="w-4 h-4 text-brand-500 flex-shrink-0" />
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div className="border border-rose-200 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-rose-500 uppercase tracking-wider">Danger zone</h3>
            <div className="space-y-1">
              <p className="text-xs font-medium text-zinc-300">Clear all messages</p>
              <p className="text-xs text-zinc-500">Permanently removes all messages. The channel itself is kept.</p>
              <button
                onClick={handleClear}
                disabled={clearing || deleting}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-200 text-rose-600 text-sm font-medium hover:bg-rose-50 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {clearing ? 'Clearing…' : 'Clear messages'}
              </button>
            </div>
            <div className="border-t border-rose-100 pt-3 space-y-1">
              <p className="text-xs font-medium text-zinc-300">Delete channel</p>
              <p className="text-xs text-zinc-500">Permanently deletes the channel and all its messages.</p>
              <button
                onClick={handleDelete}
                disabled={deleting || clearing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-200 text-rose-600 text-sm font-medium hover:bg-rose-50 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? 'Deleting…' : `Delete #${channel.name}`}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-white/10 flex-shrink-0">
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="btn-primary py-2 px-5 flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={onClose} className="btn-secondary py-2 px-4">Cancel</button>
        </div>
      </div>
    </div>
  )
}
