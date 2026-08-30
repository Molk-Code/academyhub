import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, AlertTriangle, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useCollection } from '@/hooks/useFirestore'
import type { InventoryProjectDoc } from '@/types'
import { cn } from '@/lib/utils'
import LoadingSpinner from '@/components/common/LoadingSpinner'

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function daysDiff(dateStr: string): number {
  const diff = new Date(today()).getTime() - new Date(dateStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function statusChip(status: InventoryProjectDoc['status']) {
  switch (status) {
    case 'active':      return 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50'
    case 'checked-out': return 'bg-blue-950/50 text-blue-400 border-blue-800/50'
    case 'returned':    return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50'
    case 'archived':    return 'bg-zinc-800/50 text-zinc-500 border-zinc-700/50'
  }
}

export default function InventoryDashboard() {
  const navigate = useNavigate()
  const [archivedOpen,   setArchivedOpen]   = useState(false)
  const [deletingId,     setDeletingId]     = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const { data: projects, loading } = useCollection<InventoryProjectDoc>('inventory_projects', [])

  async function deleteProject(id: string) {
    setDeletingId(id)
    try {
      // Delete subcollection items first
      const itemsSnap = await getDocs(collection(db, `inventory_projects/${id}/items`))
      await Promise.all(itemsSnap.docs.map(d => deleteDoc(d.ref)))
      await deleteDoc(doc(db, 'inventory_projects', id))
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const todayStr = today()

  const activeProjects   = projects.filter(p => p.status !== 'archived')
  const archivedProjects = projects.filter(p => p.status === 'archived')

  const overdueProjects = activeProjects.filter(
    p => p.returnDate < todayStr && p.status !== 'returned' && p.status !== 'archived',
  )

  if (loading) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Equipment Inventory</h1>
          <p className="text-zinc-400 text-sm mt-1">Manage equipment checkouts and returns for student projects.</p>
        </div>
        <button
          onClick={() => navigate('/teacher/inventory/create')}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm"
        >
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-2xl border border-white/8 p-4">
          <p className="text-xs text-zinc-500 font-medium mb-1">Active Projects</p>
          <p className="text-3xl font-bold text-orange-400">{activeProjects.length}</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-white/8 p-4">
          <p className="text-xs text-zinc-500 font-medium mb-1">Checked Out Items</p>
          <p className="text-3xl font-bold text-blue-400">—</p>
          <p className="text-xs text-zinc-600 mt-0.5">Open project to view</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-white/8 p-4">
          <p className="text-xs text-zinc-500 font-medium mb-1">Overdue Returns</p>
          <p className="text-3xl font-bold text-red-400">{overdueProjects.length}</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-white/8 p-4">
          <p className="text-xs text-zinc-500 font-medium mb-1">Damaged Items</p>
          <p className="text-3xl font-bold text-amber-400">—</p>
          <p className="text-xs text-zinc-600 mt-0.5">Open project to view</p>
        </div>
      </div>

      {/* Active projects */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Active Projects</h2>
        {activeProjects.length === 0 ? (
          <div className="bg-zinc-900 rounded-2xl border border-white/8 p-10 text-center">
            <Package className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 text-sm">No active projects yet.</p>
            <button
              onClick={() => navigate('/teacher/inventory/create')}
              className="mt-4 text-orange-400 hover:text-orange-300 text-sm font-medium"
            >
              Create your first project →
            </button>
          </div>
        ) : (
          activeProjects.map(project => {
            const isOverdue = project.returnDate < todayStr && project.status !== 'returned' && project.status !== 'archived'
            const overdueDays = isOverdue ? daysDiff(project.returnDate) : 0
            const isConfirming = confirmDeleteId === project.id
            const isDeleting   = deletingId === project.id
            return (
              <div
                key={project.id}
                className="group w-full text-left bg-zinc-900 hover:bg-zinc-800/70 rounded-2xl border border-white/8 p-4 transition-colors cursor-pointer"
                onClick={() => navigate(`/teacher/inventory/project/${project.id}`)}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-zinc-100">{project.name}</span>
                      {isOverdue && (
                        <span className="flex items-center gap-1 text-xs font-semibold bg-red-950/60 text-red-400 border border-red-800/50 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> {overdueDays}d overdue
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400 mb-2">
                      {project.borrowers.length > 0 ? project.borrowers.join(', ') : 'No borrowers'}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {project.checkoutDate} → {project.returnDate}
                      {project.equipmentManagerName && ` · Manager: ${project.equipmentManagerName}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border capitalize', statusChip(project.status))}>
                      {project.status}
                    </span>
                    {isConfirming ? (
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <button
                          disabled={isDeleting}
                          onClick={() => deleteProject(project.id)}
                          className="text-xs font-semibold bg-red-600 hover:bg-red-500 text-white px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isDeleting ? 'Deleting…' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(project.id) }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-950/30 transition-all"
                        title="Delete project"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Archived projects */}
      {archivedProjects.length > 0 && (
        <div>
          <button
            onClick={() => setArchivedOpen(o => !o)}
            className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-2"
          >
            {archivedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Archived Projects ({archivedProjects.length})
          </button>
          {archivedOpen && (
            <div className="space-y-2">
              {archivedProjects.map(project => {
                const isConfirming = confirmDeleteId === project.id
                const isDeleting   = deletingId === project.id
                return (
                  <div
                    key={project.id}
                    className="group w-full text-left bg-zinc-900/60 hover:bg-zinc-800/50 rounded-xl border border-white/6 p-4 transition-colors opacity-60 hover:opacity-80 cursor-pointer"
                    onClick={() => navigate(`/teacher/inventory/project/${project.id}`)}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <span className="font-medium text-zinc-300">{project.name}</span>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {project.borrowers.join(', ')} · {project.checkoutDate} → {project.returnDate}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', statusChip(project.status))}>
                          archived
                        </span>
                        {isConfirming ? (
                          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                            <button
                              disabled={isDeleting}
                              onClick={() => deleteProject(project.id)}
                              className="text-xs font-semibold bg-red-600 hover:bg-red-500 text-white px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {isDeleting ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); setConfirmDeleteId(project.id) }}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-950/30 transition-all"
                            title="Delete project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
