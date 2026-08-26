import { useState, useRef, useEffect, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  collection, addDoc, deleteDoc, doc, updateDoc, setDoc,
  serverTimestamp, arrayUnion, arrayRemove, getDocs, writeBatch,
} from 'firebase/firestore'
import { uploadWithQuota } from '@/lib/uploadWithQuota'
import {
  Hash, Plus, Trash2, Send, Paperclip, Smile,
  X, FileText, Download, Settings, Lock, Globe,
  UserPlus, ChevronDown, ChevronUp, SlidersHorizontal, ArrowLeft, MessageSquare, Search,
} from 'lucide-react'
import { format, isToday, isYesterday, differenceInMinutes } from 'date-fns'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, orderBy, useDocument, where } from '@/hooks/useFirestore'
import type { ChatChannelDoc, ChatMessageDoc, ChatSettingsDoc, CohortDoc, UserDoc, UserRole, ProductionTeamDoc } from '@/types'
import { canAccessChannel, markChannelRead } from '@/lib/chat'
import { useSeenRevision } from '@/lib/seenSignal'
import Avatar from '@/components/common/Avatar'
import { cn } from '@/lib/utils'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥', '🎉', '👀', '✅', '💯', '🙌', '😢', '👎']

function dateDividerLabel(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'd MMMM yyyy')
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}


// ── Chat Global Settings Modal ────────────────────────────────────────────────

const RETENTION_OPTIONS: { label: string; value: number | null }[] = [
  { label: '7 days',    value: 7   },
  { label: '14 days',   value: 14  },
  { label: '30 days',   value: 30  },
  { label: '60 days',   value: 60  },
  { label: '90 days',   value: 90  },
  { label: '180 days',  value: 180 },
  { label: '1 year',    value: 365 },
  { label: 'Forever',   value: null },
]

function ChatGlobalSettingsModal({ onClose }: { onClose: () => void }) {
  const { data: settings } = useDocument<ChatSettingsDoc & { id: string }>('chat_settings', 'global')
  const [retentionDays, setRetentionDays] = useState<number | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings !== null && retentionDays === undefined) {
      setRetentionDays(settings?.retentionDays ?? null)
    }
  }, [settings])

  async function save() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'chat_settings', 'global'), { retentionDays })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const current = retentionDays === undefined ? (settings?.retentionDays ?? null) : retentionDays

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl border border-white/10 w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-zinc-100">Chat settings</h2>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-sm font-semibold text-zinc-300 block mb-1">Message retention</label>
            <p className="text-xs text-zinc-400 mb-3">Messages older than this will be automatically deleted.</p>
            <div className="grid grid-cols-2 gap-1.5">
              {RETENTION_OPTIONS.map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => setRetentionDays(opt.value)}
                  className={cn(
                    'px-3 py-2 rounded-xl text-sm font-medium border transition-all',
                    current === opt.value
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'border-white/10 text-zinc-400 hover:border-white/15 hover:bg-white/5',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-white/10">
          <button
            onClick={save}
            disabled={saving || retentionDays === undefined}
            className="btn-primary py-2 px-5 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="btn-secondary py-2 px-4">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Channel Settings Modal ─────────────────────────────────────────────────────

function ChannelSettingsModal({
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

// ── Main chat page ─────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { profile, roles, cohortId } = useAuth()
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin  = roles.includes('admin') && pathname.startsWith('/admin')
  const isStudentPath = !pathname.startsWith('/teacher') && !pathname.startsWith('/admin')
  const seenRev  = useSeenRevision()

  const { data: myTeams } = useCollection<ProductionTeamDoc>(
    'production_teams',
    cohortId ? [where('cohortId', '==', cohortId)] : [],
    !!cohortId && !!profile,
    cohortId ?? '',
  )
  const myTeamIds = useMemo(
    () => myTeams.filter(t => profile && t.memberIds.includes(profile.uid)).map(t => t.id),
    [myTeams, profile],
  )

  const [activeChannelId,    setActiveChannelId]    = useState<string | null>(null)
  const [mobileChatView,     setMobileChatView]     = useState<'channels' | 'messages'>('channels')
  const [searchQuery,        setSearchQuery]        = useState('')
  const [isSearching,        setIsSearching]        = useState(false)
  const [inputText,          setInputText]          = useState('')
  const [pendingFiles,       setPendingFiles]       = useState<File[]>([])
  const [sending,            setSending]            = useState(false)
  const [emojiPickerMsgId,   setEmojiPickerMsgId]   = useState<string | null>(null)
  const [settingsChannelId,  setSettingsChannelId]  = useState<string | null>(null)
  const [addChannelOpen,     setAddChannelOpen]     = useState(false)
  const [newChannelName,     setNewChannelName]     = useState('')
  const [newChannelDesc,     setNewChannelDesc]     = useState('')
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [dmPickerOpen,       setDmPickerOpen]       = useState(false)
  const [dmSearch,           setDmSearch]           = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)

  const { data: allChannels } = useCollection<ChatChannelDoc>(
    'chat_channels',
    [orderBy('order', 'asc')],
  )
  const { data: allUsers } = useCollection<UserDoc>('users')

  const channels = allChannels.filter(ch =>
    canAccessChannel(ch, profile?.uid ?? '', roles, profile?.cohortId ?? null, myTeamIds),
  )
  const regularChannels = useMemo(() => channels.filter(ch => !ch.isDM), [channels])
  const dmChannels      = useMemo(() => channels.filter(ch => ch.isDM), [channels])

  const unreadChannelIds = useMemo(() => {
    const set = new Set<string>()
    if (!profile) return set
    for (const ch of channels) {
      if (!ch.lastMessageAt) continue
      const lastRead = localStorage.getItem(`chatRead:${profile.uid}:${ch.id}`)
      if (!lastRead || ch.lastMessageAt.toMillis() > parseInt(lastRead, 10)) set.add(ch.id)
    }
    return set
  }, [channels, profile, seenRev])

  // Default to first regular channel
  useEffect(() => {
    if (regularChannels.length > 0 && (!activeChannelId || !channels.find(c => c.id === activeChannelId))) {
      setActiveChannelId(regularChannels[0].id)
    }
  }, [regularChannels]) // eslint-disable-line react-hooks/exhaustive-deps

  const dmOtherUser = useMemo(() => {
    const active = channels.find(c => c.id === activeChannelId)
    if (!active?.isDM) return null
    const otherId = active.memberIds.find(id => id !== profile?.uid)
    const found = allUsers.find(u => u.id === otherId)
    if (found) return found
    const fallbackName = active.name
      .replace(new RegExp(`\\s*&\\s*${profile?.displayName}`, 'i'), '')
      .replace(new RegExp(`${profile?.displayName}\\s*&\\s*`, 'i'), '')
      .trim() || active.name
    return { id: otherId ?? '', displayName: fallbackName, avatarUrl: null } as any
  }, [activeChannelId, channels, allUsers, profile?.uid, profile?.displayName])

  const { data: messages, loading: msgsLoading } = useCollection<ChatMessageDoc>(
    activeChannelId ? `chat_channels/${activeChannelId}/messages` : 'chat_channels',
    [orderBy('createdAt', 'asc')],
    !!activeChannelId,
    activeChannelId ?? '',
  )

  const displayedMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages
    const q = searchQuery.toLowerCase()
    return messages.filter(m =>
      m.content?.toLowerCase().includes(q) ||
      m.authorName?.toLowerCase().includes(q),
    )
  }, [messages, searchQuery])

  function highlightText(text: string, query: string): React.ReactNode {
    if (!query.trim()) return text
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-orange-500/30 text-orange-200 rounded px-0.5">{part}</mark>
        : part,
    )
  }

  // Mark read when switching channels OR when new messages arrive on the active channel
  useEffect(() => {
    if (profile && activeChannelId) markChannelRead(profile.uid, activeChannelId)
  }, [activeChannelId, messages.length, profile?.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setIsSearching(false)
    setSearchQuery('')
  }, [activeChannelId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [inputText])

  const activeChannel     = channels.find(c => c.id === activeChannelId) ?? null
  const settingsChannel   = allChannels.find(c => c.id === settingsChannelId) ?? null

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function sendMessage() {
    if (!profile || !activeChannelId || (!inputText.trim() && pendingFiles.length === 0) || sending) return
    setSending(true)
    try {
      const attachments = await Promise.all(
        pendingFiles.map(async file => {
          const path = `chat/${activeChannelId}/${Date.now()}_${file.name}`
          const url  = await uploadWithQuota(file, path)
          return { url, name: file.name, type: file.type, size: file.size }
        }),
      )
      await addDoc(collection(db, `chat_channels/${activeChannelId}/messages`), {
        authorId:        profile.uid,
        authorName:      profile.displayName,
        authorAvatarUrl: profile.avatarUrl ?? null,
        content:         inputText.trim(),
        attachments,
        reactions:       {},
        createdAt:       serverTimestamp(),
      })
      // Reset immediately after the message is saved — don't wait for the channel update
      setInputText('')
      setPendingFiles([])
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      textareaRef.current?.focus()
      await updateDoc(doc(db, 'chat_channels', activeChannelId), {
        lastMessageAt: serverTimestamp(),
      })
    } finally {
      setSending(false)
    }
  }

  async function toggleReaction(message: ChatMessageDoc, emoji: string) {
    if (!profile || !activeChannelId) return
    const msgRef       = doc(db, `chat_channels/${activeChannelId}/messages`, message.id)
    const alreadyReacted = (message.reactions?.[emoji] ?? []).includes(profile.uid)
    if (alreadyReacted) {
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayRemove(profile.uid) })
    } else {
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayUnion(profile.uid) })
    }
    setEmojiPickerMsgId(null)
  }

  async function deleteMessage(messageId: string) {
    if (!activeChannelId || !confirm('Delete this message?')) return
    await deleteDoc(doc(db, `chat_channels/${activeChannelId}/messages`, messageId))
  }

  async function createChannel() {
    if (!newChannelName.trim() || !profile) return
    const name    = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const newRef  = await addDoc(collection(db, 'chat_channels'), {
      name,
      description:      newChannelDesc.trim(),
      order:            allChannels.length,
      isPublic:         true,
      allowedRoles:     [],
      allowedCohortIds: [],
      allowedTeamIds:   [],
      memberIds:        [],
      createdAt:        serverTimestamp(),
      createdBy:        profile.uid,
    })
    setActiveChannelId(newRef.id)
    setNewChannelName('')
    setNewChannelDesc('')
    setAddChannelOpen(false)
  }

  async function startDM(targetUser: UserDoc) {
    if (!profile) return
    setDmPickerOpen(false)
    const existing = dmChannels.find(ch => ch.memberIds.includes(targetUser.id))
    if (existing) { setActiveChannelId(existing.id); setMobileChatView('messages'); return }
    const newRef = await addDoc(collection(db, 'chat_channels'), {
      isDM:             true,
      memberIds:        [profile.uid, targetUser.id],
      name:             `${profile.displayName} & ${targetUser.displayName}`,
      description:      '',
      isPublic:         false,
      order:            9999,
      allowedRoles:     [],
      allowedCohortIds: [],
      allowedTeamIds:   [],
      createdAt:        serverTimestamp(),
      createdBy:        profile.uid,
    })
    setActiveChannelId(newRef.id)
    setMobileChatView('messages')
  }

  // Open DM from ?dm=UID URL param (e.g. teacher navigating from student detail)
  useEffect(() => {
    const targetUid = searchParams.get('dm')
    if (!targetUid || !profile || allUsers.length === 0) return
    const targetUser = allUsers.find(u => u.uid === targetUid)
    if (!targetUser) return
    setSearchParams({}, { replace: true })
    startDM(targetUser)
  }, [searchParams.get('dm'), profile?.uid, allUsers.length])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPendingFiles(prev => [...prev, ...Array.from(e.target.files ?? [])])
    e.target.value = ''
  }

  function isGrouped(index: number): boolean {
    if (index === 0) return false
    const prev = messages[index - 1]
    const curr = messages[index]
    if (prev.authorId !== curr.authorId) return false
    const prevT = prev.createdAt?.toDate?.()
    const currT = curr.createdAt?.toDate?.()
    if (!prevT || !currT) return false
    return differenceInMinutes(currT, prevT) < 5
  }

  function getDivider(index: number): string | null {
    const curr = messages[index].createdAt?.toDate?.()
    if (!curr) return null
    if (index === 0) return dateDividerLabel(curr)
    const prev = messages[index - 1].createdAt?.toDate?.()
    if (!prev) return null
    return dateDividerLabel(prev) !== dateDividerLabel(curr) ? dateDividerLabel(curr) : null
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex overflow-hidden h-full flex-1">

        {/* ── Channel sidebar ─────────────────────────────────────────────── */}
        <div className={cn(
          'flex-shrink-0 bg-slate-900 flex flex-col select-none',
          'md:w-52',
          mobileChatView === 'channels' ? 'w-full' : 'hidden md:flex',
        )}>
          <div className="px-4 pt-4 pb-2 flex-shrink-0">
            <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Channels</p>
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-px">
            {regularChannels.map(ch => {
              const isActive   = activeChannelId === ch.id
              const isPrivate  = ch.isPublic === false
              const unread     = !isActive && unreadChannelIds.has(ch.id)
              return (
                <div
                  key={ch.id}
                  onClick={() => { setActiveChannelId(ch.id); setMobileChatView('messages') }}
                  className={cn(
                    'group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-colors',
                    isActive
                      ? 'bg-slate-600 text-white'
                      : 'text-zinc-400 hover:bg-zinc-700/70 hover:text-slate-200',
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {isPrivate
                      ? <Lock className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                      : <Hash className="w-4 h-4 flex-shrink-0 opacity-60" />
                    }
                    <span className={cn('text-sm truncate', unread ? 'font-bold text-white' : 'font-medium')}>
                      {ch.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {unread && (
                      <span className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0" />
                    )}
                    {isAdmin && (
                      <button
                        onClick={e => { e.stopPropagation(); setSettingsChannelId(ch.id) }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-500 hover:text-slate-200 transition-all"
                        title="Channel settings"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* ── Direct Messages ────────────────────────────────────────── */}
            <div className="pt-3 pb-1 px-2 flex items-center justify-between">
              <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Direct Messages</p>
              <button
                onClick={() => { setDmPickerOpen(true); setDmSearch('') }}
                className="p-0.5 rounded text-zinc-500 hover:text-slate-200 transition-colors"
                title="New direct message"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {dmChannels.map(ch => {
              const isActive  = activeChannelId === ch.id
              const otherId   = ch.memberIds.find(id => id !== profile?.uid)
              const otherUser = allUsers.find(u => u.id === otherId)
              const unread    = !isActive && unreadChannelIds.has(ch.id)
              const fallback = ch.name.replace(new RegExp(`\\s*&\\s*${profile?.displayName}`, 'i'), '').replace(new RegExp(`${profile?.displayName}\\s*&\\s*`, 'i'), '').trim() || ch.name
              const displayName = otherUser?.displayName ?? fallback
              const avatarUrl = otherUser?.avatarUrl ?? null
              return (
                <div
                  key={ch.id}
                  onClick={() => { setActiveChannelId(ch.id); setMobileChatView('messages') }}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors',
                    isActive
                      ? 'bg-slate-600 text-white'
                      : 'text-zinc-400 hover:bg-zinc-700/70 hover:text-slate-200',
                  )}
                >
                  <Avatar uid={otherId ?? ''} name={displayName} avatarUrl={avatarUrl} size="sm" />
                  <span className={cn('text-sm flex-1 truncate', unread ? 'font-bold text-white' : 'font-medium')}>
                    {displayName}
                  </span>
                  {unread && <span className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0" />}
                </div>
              )
            })}
            {dmChannels.length === 0 && (
              <button
                onClick={() => { setDmPickerOpen(true); setDmSearch('') }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Start a conversation
              </button>
            )}
          </div>

          {profile && (
            <div className="p-3 border-t border-slate-700/50 flex-shrink-0 space-y-1">
              {isAdmin && (
                <button
                  onClick={() => setGlobalSettingsOpen(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-slate-200 hover:bg-zinc-700 transition-colors"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  Chat settings
                </button>
              )}
              {addChannelOpen ? (
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={newChannelName}
                    onChange={e => setNewChannelName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') createChannel()
                      if (e.key === 'Escape') { setAddChannelOpen(false); setNewChannelName(''); setNewChannelDesc('') }
                    }}
                    placeholder="channel-name"
                    className="w-full bg-zinc-700 text-white text-sm rounded-lg px-2.5 py-1.5 placeholder-slate-500 outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <input
                    value={newChannelDesc}
                    onChange={e => setNewChannelDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full bg-zinc-700 text-white text-sm rounded-lg px-2.5 py-1.5 placeholder-slate-500 outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={createChannel}
                      disabled={!newChannelName.trim()}
                      className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg py-1.5 transition-colors"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => { setAddChannelOpen(false); setNewChannelName(''); setNewChannelDesc('') }}
                      className="px-2 bg-zinc-700 hover:bg-slate-600 text-zinc-300 rounded-lg transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddChannelOpen(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-slate-200 hover:bg-zinc-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add channel
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Main message area ────────────────────────────────────────────── */}
        <div className={cn(
          'flex-1 flex flex-col bg-zinc-900 overflow-hidden',
          mobileChatView === 'messages' ? 'flex' : 'hidden md:flex',
        )}>
          {!activeChannel ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
                <Hash className="w-8 h-8 text-zinc-300" />
              </div>
              <div>
                <p className="text-zinc-300 font-semibold">
                  {channels.length === 0 ? 'No channels available' : 'Select a channel'}
                </p>
                <p className="text-zinc-400 text-sm mt-0.5">
                  {channels.length === 0
                    ? isAdmin
                      ? 'Create the first channel to get started.'
                      : 'Ask an admin to create channels or add you to one.'
                    : 'Pick a channel from the sidebar to start chatting.'}
                </p>
              </div>
              {isAdmin && channels.length === 0 && (
                <button onClick={() => setAddChannelOpen(true)} className="btn-primary py-2 px-4 text-sm flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> Create channel
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Channel header */}
              <div className="flex items-center gap-2 px-4 h-14 border-b border-white/10 flex-shrink-0 shadow-sm">
                <button
                  onClick={() => setMobileChatView('channels')}
                  className="md:hidden p-1 -ml-1 text-zinc-400 hover:text-zinc-300 rounded-lg transition-colors flex-shrink-0"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                {activeChannel.isDM ? (
                  <>
                    <Avatar uid={dmOtherUser?.id ?? ''} name={dmOtherUser?.displayName ?? '?'} avatarUrl={dmOtherUser?.avatarUrl} size="sm" />
                    <span className="text-base font-bold text-zinc-100">{dmOtherUser?.displayName ?? 'Direct Message'}</span>
                  </>
                ) : (
                  <>
                    {activeChannel.isPublic === false
                      ? <Lock className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                      : <Hash className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                    }
                    <span className="text-base font-bold text-zinc-100">{activeChannel.name}</span>
                    {activeChannel.description && (
                      <>
                        <span className="text-zinc-300 mx-0.5">|</span>
                        <span className="text-sm text-zinc-500 truncate">{activeChannel.description}</span>
                      </>
                    )}
                  </>
                )}
                <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { setIsSearching(s => !s); if (isSearching) setSearchQuery('') }}
                    className={cn(
                      'p-1.5 rounded-lg transition-colors',
                      isSearching ? 'bg-orange-500/20 text-orange-400' : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800',
                    )}
                    title="Search messages"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => setSettingsChannelId(activeChannel.id)}
                      className="p-1.5 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                      title="Channel settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Search bar */}
              {isSearching && (
                <div className="px-4 py-2 border-b border-white/8 flex-shrink-0">
                  <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2">
                    <Search className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                    <input
                      autoFocus
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search messages…"
                      className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">✕</button>
                    )}
                  </div>
                  {searchQuery && (
                    <p className="text-xs text-zinc-500 mt-1 px-1">
                      {displayedMessages.length} result{displayedMessages.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {msgsLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
                      <Hash className="w-8 h-8 text-zinc-300" />
                    </div>
                    <p className="text-zinc-300 font-semibold">Welcome to #{activeChannel.name}!</p>
                    <p className="text-zinc-400 text-sm mt-1">👋 Be the first to say something</p>
                  </div>
                ) : (
                  <div className="space-y-px">
                    {displayedMessages.map((msg, index) => {
                      const grouped   = searchQuery ? false : isGrouped(index)
                      const divider   = searchQuery ? null  : getDivider(index)
                      const msgTime   = msg.createdAt?.toDate?.()
                      const isOwn     = msg.authorId === profile?.uid
                      const canDelete = isOwn || isAdmin
                      const reactions = msg.reactions ?? {}
                      const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0)

                      return (
                        <div key={msg.id}>
                          {divider && (
                            <div className="flex items-center gap-3 my-5">
                              <div className="flex-1 h-px bg-zinc-700" />
                              <span className="text-xs text-zinc-400 font-medium">{divider}</span>
                              <div className="flex-1 h-px bg-zinc-700" />
                            </div>
                          )}

                          <div className={cn(
                            'group relative flex gap-3 px-2 py-0.5 rounded-lg hover:bg-white/5/80 transition-colors',
                            grouped ? 'mt-0.5' : 'mt-3',
                          )}>
                            {/* Avatar / grouped timestamp */}
                            <div className="w-10 flex-shrink-0 pt-0.5 flex justify-center">
                              {grouped ? (
                                <span className="text-[10px] text-zinc-400 tabular-nums opacity-0 group-hover:opacity-100 transition-opacity leading-5 mt-0.5">
                                  {msgTime ? format(msgTime, 'HH:mm') : ''}
                                </span>
                              ) : (
                                <Avatar uid={msg.authorId} name={msg.authorName} avatarUrl={msg.authorAvatarUrl} size="sm" />
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              {!grouped && (
                                <div className="flex items-baseline gap-2 mb-0.5">
                                  <span className="text-sm font-semibold text-zinc-100 leading-5">{msg.authorName}</span>
                                  <span className="text-[11px] text-zinc-400 leading-5">
                                    {msgTime ? format(msgTime, 'HH:mm') : ''}
                                  </span>
                                </div>
                              )}

                              {msg.content && (
                                <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">{highlightText(msg.content, searchQuery)}</p>
                              )}

                              {/* Attachments */}
                              {msg.attachments?.length > 0 && (
                                <div className="mt-2 flex flex-col items-start gap-1.5">
                                  {msg.attachments.map((att, i) =>
                                    att.type.startsWith('image/') ? (
                                      <a key={i} href={att.url} target="_blank" rel="noreferrer" className="block">
                                        <img
                                          src={att.url}
                                          alt={att.name}
                                          className="max-w-sm max-h-72 rounded-xl border border-white/10 object-cover hover:opacity-90 transition-opacity"
                                        />
                                      </a>
                                    ) : (
                                      <a
                                        key={i}
                                        href={att.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-3 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-xl px-3 py-2.5 transition-colors max-w-xs"
                                      >
                                        <FileText className="w-5 h-5 text-brand-500 flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-medium text-zinc-200 truncate">{att.name}</p>
                                          <p className="text-xs text-zinc-400">{fileSize(att.size)}</p>
                                        </div>
                                        <Download className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                                      </a>
                                    ),
                                  )}
                                </div>
                              )}

                              {/* Reactions */}
                              {reactionEntries.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {reactionEntries.map(([emoji, users]) => {
                                    const reacted = users.includes(profile?.uid ?? '')
                                    return (
                                      <button
                                        key={emoji}
                                        onClick={() => toggleReaction(msg, emoji)}
                                        className={cn(
                                          'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-all',
                                          reacted
                                            ? 'bg-brand-50 border-brand-200 text-brand-700 hover:bg-brand-100'
                                            : 'bg-zinc-800 border-white/10 text-zinc-400 hover:bg-zinc-700',
                                        )}
                                      >
                                        <span>{emoji}</span>
                                        <span>{users.length}</span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Hover action bar */}
                            <div className="absolute right-2 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-px bg-zinc-900 border border-white/10 rounded-lg shadow-sm px-1 py-0.5 z-10">
                              <button
                                onClick={e => { e.stopPropagation(); setEmojiPickerMsgId(emojiPickerMsgId === msg.id ? null : msg.id) }}
                                className="p-1 text-zinc-400 hover:text-zinc-300 rounded-md hover:bg-zinc-800 transition-colors"
                                title="Add reaction"
                              >
                                <Smile className="w-4 h-4" />
                              </button>
                              {canDelete && (
                                <button
                                  onClick={() => deleteMessage(msg.id)}
                                  className="p-1 text-zinc-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors"
                                  title="Delete message"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                            {/* Emoji picker */}
                            {emojiPickerMsgId === msg.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setEmojiPickerMsgId(null)} />
                                <div className="absolute right-2 top-7 bg-zinc-900 border border-white/10 rounded-xl shadow-xl p-2 z-20 flex flex-wrap gap-1" style={{ width: 210 }}>
                                  {QUICK_EMOJIS.map(emoji => (
                                    <button
                                      key={emoji}
                                      onClick={() => toggleReaction(msg, emoji)}
                                      className={cn(
                                        'w-8 h-8 flex items-center justify-center text-base rounded-lg transition-colors',
                                        (msg.reactions?.[emoji] ?? []).includes(profile?.uid ?? '')
                                          ? 'bg-brand-100'
                                          : 'hover:bg-zinc-800',
                                      )}
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className={cn('flex-shrink-0 px-5 pt-2 border-t border-white/8', isStudentPath ? 'pb-bottomnav lg:pb-4' : 'pb-4')}>
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2 p-2 bg-zinc-900/50 rounded-xl border border-white/10">
                    {pendingFiles.map((file, i) => (
                      <div key={i} className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-lg px-2 py-1.5">
                        {file.type.startsWith('image/') ? (
                          <img src={URL.createObjectURL(file)} alt={file.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        )}
                        <span className="text-xs text-zinc-300 max-w-[120px] truncate">{file.name}</span>
                        <button onClick={() => setPendingFiles(f => f.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-rose-500 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2 bg-zinc-800 rounded-2xl px-3 py-2 border border-white/10 focus-within:border-brand-300 transition-colors">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 text-zinc-400 hover:text-brand-600 transition-colors flex-shrink-0 mb-px"
                    title="Attach file or photo"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.txt,.zip,.mp4,.mov,.pptx,.xlsx"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <textarea
                    ref={textareaRef}
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={activeChannel.isDM ? `Message ${dmOtherUser?.displayName ?? ''}` : `Message #${activeChannel.name}`}
                    rows={1}
                    className="flex-1 bg-transparent text-zinc-100 placeholder-slate-400 resize-none outline-none leading-6 py-px"
                    style={{ maxHeight: 160, fontSize: '16px' }}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={(!inputText.trim() && pendingFiles.length === 0) || sending}
                    className={cn(
                      'p-1.5 rounded-xl transition-all flex-shrink-0 mb-px',
                      inputText.trim() || pendingFiles.length > 0
                        ? 'bg-brand-600 text-white hover:bg-brand-700'
                        : 'text-zinc-300 cursor-not-allowed',
                    )}
                  >
                    <Send className={cn('w-4 h-4', sending && 'animate-pulse')} />
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1 px-1">Enter to send · Shift+Enter for new line</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Global chat settings modal */}
      {globalSettingsOpen && (
        <ChatGlobalSettingsModal onClose={() => setGlobalSettingsOpen(false)} />
      )}

      {/* Channel settings modal */}
      {settingsChannel && (
        <ChannelSettingsModal
          channel={settingsChannel}
          onClose={() => setSettingsChannelId(null)}
          onDeleted={() => {
            setSettingsChannelId(null)
            if (activeChannelId === settingsChannelId) {
              const remaining = channels.filter(c => c.id !== settingsChannelId)
              setActiveChannelId(remaining[0]?.id ?? null)
            }
          }}
        />
      )}

      {/* DM user picker modal */}
      {dmPickerOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl shadow-2xl border border-white/10 w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="text-base font-semibold text-zinc-100">New Direct Message</h2>
              <button onClick={() => { setDmPickerOpen(false); setDmSearch('') }} className="p-1.5 text-zinc-400 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2 border-b border-white/10">
              <input
                type="text"
                value={dmSearch}
                onChange={e => setDmSearch(e.target.value)}
                placeholder="Search people…"
                autoFocus
                className="w-full bg-zinc-800 text-zinc-100 placeholder-zinc-500 text-sm rounded-lg px-3 py-2 outline-none border border-white/10 focus:border-brand-500"
              />
            </div>
            <div className="py-2 max-h-72 overflow-y-auto">
              {allUsers
                .filter(u => u.id !== profile?.uid && !u.disabled)
                .filter(u => !dmSearch.trim() || u.displayName.toLowerCase().includes(dmSearch.toLowerCase()))
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map(user => (
                  <button
                    key={user.id}
                    onClick={() => startDM(user)}
                    className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-white/5 transition-colors text-left"
                  >
                    <Avatar uid={user.id} name={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{user.displayName}</p>
                      <p className="text-xs text-zinc-400 capitalize">{user.role}</p>
                    </div>
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </>
  )
}
