import { useState, useMemo, useRef, useEffect } from 'react'
import { doc, setDoc, deleteDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection, orderBy } from '@/hooks/useFirestore'
import type { CrewRoleDoc, ProductionCrewAssignmentDoc, UserDoc } from '@/types'
import { Users, X } from 'lucide-react'

interface Props {
  productionId: string
  canEdit: boolean
  cohortUsers: UserDoc[]
}

interface ComboProps {
  value: string
  users: UserDoc[]
  onSave: (name: string, uid: string | null) => void
  onClear: () => void
}

function CrewCombo({ value, users, onSave, onClear }: ComboProps) {
  const [query, setQuery]     = useState(value)
  const [open,  setOpen]      = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  // Keep query in sync when external value changes (e.g. after save)
  useEffect(() => { setQuery(value) }, [value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => u.displayName.toLowerCase().includes(q))
  }, [query, users])

  function select(user: UserDoc) {
    setQuery(user.displayName)
    setOpen(false)
    onSave(user.displayName, user.uid)
  }

  function commit() {
    setOpen(false)
    const trimmed = query.trim()
    if (trimmed === value) return  // no change
    if (!trimmed) { onClear(); return }
    // Check if it exactly matches a user
    const match = users.find(u => u.displayName.toLowerCase() === trimmed.toLowerCase())
    onSave(match ? match.displayName : trimmed, match ? match.uid : null)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        listRef.current  && !listRef.current.contains(e.target as Node)
      ) commit()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, query])

  return (
    <div className="relative flex-1 min-w-0">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          className="flex-1 min-w-0 bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
          placeholder="Search or type name…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') { commit(); inputRef.current?.blur() }
            if (e.key === 'Escape') { setQuery(value); setOpen(false); inputRef.current?.blur() }
          }}
        />
        {query && (
          <button
            onMouseDown={e => { e.preventDefault(); setQuery(''); onClear(); setOpen(false) }}
            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 left-0 right-0 top-full mt-1 bg-zinc-800 border border-white/10 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-zinc-500 italic">
              {query.trim() ? `Save "${query.trim()}" as custom name` : 'No students found'}
            </div>
          ) : (
            filtered.map(u => (
              <button
                key={u.uid}
                onMouseDown={e => { e.preventDefault(); select(u) }}
                className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-white/8 transition-colors"
              >
                {u.displayName}
              </button>
            ))
          )}
          {query.trim() && !users.some(u => u.displayName.toLowerCase() === query.trim().toLowerCase()) && (
            <button
              onMouseDown={e => { e.preventDefault(); commit() }}
              className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-white/8 transition-colors border-t border-white/8"
            >
              Save "<span className="text-zinc-200">{query.trim()}</span>" as custom name
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function CrewTab({ productionId, canEdit, cohortUsers }: Props) {
  const { data: roles } = useCollection<CrewRoleDoc>('crew_roles', [orderBy('order', 'asc')])
  const { data: assignments } = useCollection<ProductionCrewAssignmentDoc>(
    `productions/${productionId}/crew`,
    [],
  )

  const assignmentMap = useMemo(
    () => Object.fromEntries(assignments.map(a => [a.roleId, a])),
    [assignments],
  )

  const sortedUsers = useMemo(
    () => [...cohortUsers].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [cohortUsers],
  )

  async function save(role: CrewRoleDoc, name: string, uid: string | null) {
    if (!name.trim()) return
    await setDoc(doc(db, `productions/${productionId}/crew`, role.id), {
      roleId: role.id, roleName: role.name,
      assignedUid: uid ?? null,
      assignedName: name.trim(),
    })
  }

  async function clear(role: CrewRoleDoc) {
    await deleteDoc(doc(db, `productions/${productionId}/crew`, role.id))
  }

  if (roles.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 text-sm">
        No crew roles have been set up yet. Ask your teacher or admin to add roles in the admin production settings.
      </div>
    )
  }

  return (
    <div className="space-y-2 max-w-lg">
      <p className="text-xs text-zinc-500 mb-4">Type to search classmates or enter any name for each role.</p>
      {roles.map(role => {
        const assignment = assignmentMap[role.id]
        return (
          <div key={role.id} className="flex items-center gap-3 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 w-44 flex-shrink-0">
              <Users className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
              <span className="text-sm font-medium text-zinc-300 truncate">{role.name}</span>
            </div>
            {canEdit ? (
              <CrewCombo
                value={assignment?.assignedName ?? ''}
                users={sortedUsers}
                onSave={(name, uid) => save(role, name, uid)}
                onClear={() => clear(role)}
              />
            ) : (
              <span className={assignment?.assignedName
                ? 'text-sm text-zinc-200'
                : 'text-sm italic text-zinc-600'
              }>
                {assignment?.assignedName || 'Unassigned'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
