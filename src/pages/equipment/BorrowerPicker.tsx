import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { X } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { UserDoc } from '@/types'

// A project's borrowers: picked from students and teachers (they get an id, so
// the project shows in their My Bookings and they can e-sign its contract) or
// typed in by name (paper contract). Used by New Project and Edit project.

export interface BorrowerCandidates { students: UserDoc[]; teachers: UserDoc[] }

export function useBorrowerCandidates(): BorrowerCandidates {
  const [students, setStudents] = useState<UserDoc[]>([])
  const [teachers, setTeachers] = useState<UserDoc[]>([])
  useEffect(() => {
    async function load() {
      const sq = await getDocs(query(collection(db, 'users'), where('roles', 'array-contains', 'student')))
      setStudents(
        sq.docs
          .map(d => ({ id: d.id, ...d.data() } as UserDoc))
          .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')),
      )
      // Active role OR any switchable role — multi-role staff may currently be
      // switched to another role, so 'role' alone misses them.
      const [tq, trq] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('role', 'in', ['teacher', 'admin']))),
        getDocs(query(collection(db, 'users'), where('roles', 'array-contains-any', ['teacher', 'admin']))),
      ])
      const staff = new Map<string, UserDoc>()
      for (const d of [...tq.docs, ...trq.docs]) staff.set(d.id, { id: d.id, ...d.data() } as UserDoc)
      setTeachers([...staff.values()].sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')))
    }
    load()
  }, [])
  return { students, teachers }
}

/**
 * The account ids for a list of borrower names. Ids already on the project stay
 * while their person is still listed (or can't be looked up); removed people
 * lose theirs.
 */
export function borrowerIdsFor(names: string[], { students, teachers }: BorrowerCandidates, existingIds: string[] = []): string[] {
  const people = [...students, ...teachers]
  const kept = existingIds.filter(id => {
    const u = people.find(p => p.id === id)
    return u ? names.includes(u.displayName) : true
  })
  const added = people.filter(p => names.includes(p.displayName)).map(p => p.id)
  return [...new Set([...kept, ...added])]
}

export function BorrowerPicker({ borrowers, onChange, candidates }: {
  borrowers: string[]
  onChange: (next: string[]) => void
  candidates: BorrowerCandidates
}) {
  const [input, setInput] = useState('')
  const { students, teachers } = candidates

  function add(n: string) {
    if (n.trim() && !borrowers.includes(n.trim())) onChange([...borrowers, n.trim()])
    setInput('')
  }

  return (
    <>
      <div className="borrower-chips">
        {borrowers.map(b => (
          <span className="borrower-chip" key={b}>
            {b}
            <button type="button" className="borrower-chip-x" aria-label={`Remove ${b}`} onClick={() => onChange(borrowers.filter(x => x !== b))}><X size={12} /></button>
          </span>
        ))}
      </div>
      {(students.length > 0 || teachers.length > 0) && (
        <select
          className="form-select borrower-dropdown"
          aria-label="Add a student or teacher"
          onChange={e => { if (e.target.value) add(e.target.value); e.target.value = '' }}
        >
          <option value="">Select student or teacher...</option>
          {students.length > 0 && (
            <optgroup label="Students">
              {students.map(s => (
                <option key={s.id} value={s.displayName}>{s.displayName}</option>
              ))}
            </optgroup>
          )}
          {teachers.length > 0 && (
            <optgroup label="Teachers">
              {teachers.map(t => (
                <option key={t.id} value={t.displayName}>{t.displayName}</option>
              ))}
            </optgroup>
          )}
        </select>
      )}
      <div className="borrower-manual-row">
        <input
          type="text"
          className="form-input"
          placeholder="Or type name and press Enter"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(input) } }}
        />
        <button type="button" className="manual-add-btn" onClick={() => add(input)}>Add</button>
      </div>
    </>
  )
}
