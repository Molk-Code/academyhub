import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection,
  query,
  getDocs,
  addDoc,
  serverTimestamp,
  where as fsWhere,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import type { UserDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'
import { X, Search } from 'lucide-react'

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function InventoryCreate() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [projectName, setProjectName]     = useState('')
  const [checkoutDate, setCheckoutDate]   = useState(todayStr())
  const [returnDate, setReturnDate]       = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState('')

  // Users
  const [students, setStudents]           = useState<UserDoc[]>([])
  const [managers, setManagers]           = useState<UserDoc[]>([])
  const [loadingUsers, setLoadingUsers]   = useState(true)

  // Borrowers multi-select
  const [selectedBorrowers, setSelectedBorrowers] = useState<UserDoc[]>([])
  const [borrowerSearch, setBorrowerSearch]         = useState('')

  // Equipment manager select
  const [managerId, setManagerId] = useState<string>('')

  useEffect(() => {
    async function fetchUsers() {
      try {
        const [studSnap, teachSnap, adminSnap] = await Promise.all([
          getDocs(query(collection(db, 'users'), fsWhere('role', '==', 'student'))),
          getDocs(query(collection(db, 'users'), fsWhere('role', '==', 'teacher'))),
          getDocs(query(collection(db, 'users'), fsWhere('role', '==', 'admin'))),
        ])
        const studs = studSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc))
        const mgrs  = [
          ...teachSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc)),
          ...adminSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserDoc)),
        ]
        setStudents(studs.sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')))
        setManagers(mgrs.sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '')))
        // Default manager to current user
        if (profile?.uid) setManagerId(profile.uid)
      } finally {
        setLoadingUsers(false)
      }
    }
    fetchUsers()
  }, [profile?.uid])

  const filteredStudents = students.filter(s => {
    const alreadySelected = selectedBorrowers.some(b => b.id === s.id)
    const matchesSearch   = !borrowerSearch || (s.displayName ?? '').toLowerCase().includes(borrowerSearch.toLowerCase())
    return !alreadySelected && matchesSearch
  })

  function addBorrower(student: UserDoc) {
    setSelectedBorrowers(prev => [...prev, student])
    setBorrowerSearch('')
  }

  function removeBorrower(uid: string) {
    setSelectedBorrowers(prev => prev.filter(b => b.id !== uid))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!projectName.trim())  { setError('Project name is required.'); return }
    if (!returnDate)           { setError('Return date is required.'); return }
    if (!managerId)            { setError('Equipment manager is required.'); return }

    const managerDoc = managers.find(m => m.id === managerId)

    setSubmitting(true)
    try {
      const docRef = await addDoc(collection(db, 'inventory_projects'), {
        name:                 projectName.trim(),
        borrowers:            selectedBorrowers.map(b => b.displayName ?? ''),
        borrowerIds:          selectedBorrowers.map(b => b.id),
        equipmentManagerId:   managerId,
        equipmentManagerName: managerDoc?.displayName ?? '',
        cohortId:             profile?.cohortId ?? '',
        checkoutDate,
        returnDate,
        status:               'active',
        createdAt:            serverTimestamp(),
        updatedAt:            serverTimestamp(),
      })
      navigate(`/teacher/inventory/project/${docRef.id}`)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create project.')
      setSubmitting(false)
    }
  }

  if (loadingUsers) return <LoadingSpinner />

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">New Inventory Project</h1>
        <p className="text-zinc-400 text-sm mt-1">Create a project to track equipment checkout and return.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-zinc-900 rounded-2xl border border-white/8 p-6 space-y-5">
        {/* Project name */}
        <div>
          <label className="label">Project Name *</label>
          <input
            type="text"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            className="input w-full"
            placeholder="e.g. Short Film Production — Group A"
          />
        </div>

        {/* Borrowers */}
        <div>
          <label className="label">Borrowers</label>
          {/* Selected chips */}
          {selectedBorrowers.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedBorrowers.map(b => (
                <span
                  key={b.id}
                  className="flex items-center gap-1.5 text-sm bg-orange-500/15 text-orange-300 border border-orange-500/30 px-2.5 py-1 rounded-full"
                >
                  {b.displayName}
                  <button
                    type="button"
                    onClick={() => removeBorrower(b.id)}
                    className="hover:text-orange-100 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              value={borrowerSearch}
              onChange={e => setBorrowerSearch(e.target.value)}
              className="input w-full pl-9"
              placeholder="Search students…"
            />
          </div>
          {/* Dropdown list */}
          {borrowerSearch && filteredStudents.length > 0 && (
            <div className="mt-1 bg-zinc-800 border border-white/10 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
              {filteredStudents.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addBorrower(s)}
                  className="w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
                >
                  {s.displayName}
                  {s.email && <span className="text-zinc-500 ml-2 text-xs">{s.email}</span>}
                </button>
              ))}
            </div>
          )}
          {borrowerSearch && filteredStudents.length === 0 && (
            <p className="text-xs text-zinc-500 mt-1 px-1">No students found.</p>
          )}
        </div>

        {/* Equipment manager */}
        <div>
          <label className="label">Equipment Manager *</label>
          <select
            value={managerId}
            onChange={e => setManagerId(e.target.value)}
            className="input w-full"
          >
            <option value="">Select a manager…</option>
            {managers.map(m => (
              <option key={m.id} value={m.id}>
                {m.displayName}{m.id === profile?.uid ? ' (me)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Checkout Date</label>
            <input
              type="date"
              value={checkoutDate}
              onChange={e => setCheckoutDate(e.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="label">Return Date *</label>
            <input
              type="date"
              value={returnDate}
              min={checkoutDate}
              onChange={e => setReturnDate(e.target.value)}
              className="input w-full"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-950/30 border border-red-800/40 rounded-xl px-3 py-2">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => navigate('/teacher/inventory')}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={cn(
              'flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors',
              submitting && 'opacity-60 cursor-not-allowed',
            )}
          >
            {submitting ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  )
}
