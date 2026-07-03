import { useState, useEffect } from 'react'
import { collection, getDocs, query, orderBy, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CallSheetPreviewModal } from './CallSheetPreviewModal'
import type {
  ProductionShootingDayDoc, ProductionSceneDoc, ProductionCastDoc,
  ProductionCrewAssignmentDoc, ProductionLocationDoc, CrewRoleDoc, ProductionShotDoc,
} from '@/types'
import { Loader2 } from 'lucide-react'

interface Props {
  productionId: string
  productionTitle: string
  date: string
  onClose: () => void
}

export function PeriodCallSheetLoader({ productionId, productionTitle, date, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{
    day: ProductionShootingDayDoc
    dayNumber: number
    totalDays: number
    dayScenes: ProductionSceneDoc[]
    allCast: ProductionCastDoc[]
    crew: ProductionCrewAssignmentDoc[]
    crewRoles: CrewRoleDoc[]
    locations: ProductionLocationDoc[]
    shots: ProductionShotDoc[]
  } | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      const [daysSnap, scenesSnap, castSnap, crewSnap, crewRolesSnap, locSnap, shotsSnap] = await Promise.all([
        getDocs(query(collection(db, `productions/${productionId}/shootingDays`), orderBy('dayNumber', 'asc'))),
        getDocs(query(collection(db, `productions/${productionId}/scenes`), orderBy('sceneNumber', 'asc'))),
        getDocs(query(collection(db, `productions/${productionId}/cast`), orderBy('castId', 'asc'))),
        getDocs(collection(db, `productions/${productionId}/crew`)),
        getDocs(query(collection(db, 'crew_roles'), orderBy('order', 'asc'))),
        getDocs(collection(db, `productions/${productionId}/locations`)),
        getDocs(collection(db, `productions/${productionId}/shots`)),
      ])
      if (!mounted) return

      const allDays = daysSnap.docs.map(d => ({ id: d.id, ...d.data() })) as ProductionShootingDayDoc[]
      const day = allDays.find(d => d.date === date)
      if (!day) { setLoading(false); return }

      const totalDays = allDays.length
      const dayNumber = allDays.findIndex(d => d.id === day.id) + 1

      const allScenes = scenesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as ProductionSceneDoc[]
      const dayScenes = allScenes.filter(s => (day.sceneIds ?? []).includes(s.id))

      setData({
        day,
        dayNumber,
        totalDays,
        dayScenes,
        allCast: castSnap.docs.map(d => ({ id: d.id, ...d.data() })) as ProductionCastDoc[],
        crew: crewSnap.docs.map(d => ({ id: d.id, ...d.data() })) as ProductionCrewAssignmentDoc[],
        crewRoles: crewRolesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as CrewRoleDoc[],
        locations: locSnap.docs.map(d => ({ id: d.id, ...d.data() })) as ProductionLocationDoc[],
        shots: shotsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as ProductionShotDoc[],
      })
      setLoading(false)
    }
    load().catch(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [productionId, date])

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-zinc-900 border border-white/10 rounded-2xl px-8 py-10 flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
          <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          <p className="text-sm text-zinc-400">Loading call sheet…</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-zinc-900 border border-white/10 rounded-2xl px-8 py-10 text-center" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-zinc-400">Could not load call sheet data.</p>
          <button onClick={onClose} className="mt-4 text-xs text-brand-400 hover:text-brand-300">Close</button>
        </div>
      </div>
    )
  }

  return (
    <CallSheetPreviewModal
      productionTitle={productionTitle}
      day={data.day}
      dayNumber={data.dayNumber}
      totalDays={data.totalDays}
      dayScenes={data.dayScenes}
      allCast={data.allCast}
      crew={data.crew}
      crewRoles={data.crewRoles}
      locations={data.locations}
      shots={data.shots}
      onClose={onClose}
    />
  )
}
