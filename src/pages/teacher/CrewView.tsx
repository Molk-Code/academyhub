import { useMemo } from 'react'
import type { PeriodAllocationDoc, UserDoc, ProductionDoc, ProductionTeamDoc } from '@/types'
import { format, parseISO } from 'date-fns'
import { useCollection, orderBy, where } from '@/hooks/useFirestore'
import { buildColorMap } from './productionPeriodShared'

function StudentRow({ student, days, colorMap }: {
  student: UserDoc
  days: PeriodAllocationDoc[]
  colorMap: Record<string, string>
}) {
  return (
    <div className="bg-zinc-900 border border-white/10 rounded-xl p-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100">{student.displayName}</p>
        <p className="text-xs text-zinc-500">{days.length} shooting day{days.length !== 1 ? 's' : ''}</p>
      </div>
      <div className="flex flex-wrap gap-1 justify-end">
        {days.sort((a, b) => a.date.localeCompare(b.date)).map(a => (
          <span key={a.id}
            className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
            style={{ background: (colorMap[a.productionId] ?? '#6366f1') + '33', color: colorMap[a.productionId] ?? '#6366f1' }}
          >
            {format(parseISO(a.date), 'd MMM')}
          </span>
        ))}
        {days.length === 0 && <span className="text-[10px] text-zinc-600">No days assigned</span>}
      </div>
    </div>
  )
}

export function CrewView({ allocations, students, productions, cohortId }: {
  allocations: PeriodAllocationDoc[]
  students: UserDoc[]
  productions: ProductionDoc[]
  cohortId: string
}) {
  const colorMap = useMemo(() => buildColorMap(productions), [productions])

  const { data: teamsRaw } = useCollection<ProductionTeamDoc>(
    'production_teams',
    cohortId ? [where('cohortId', '==', cohortId), orderBy('order', 'asc')] : [],
    !!cohortId,
    cohortId,
  )
  const teams = useMemo(() => [...teamsRaw].sort((a, b) => a.order - b.order), [teamsRaw])

  const byStudent = useMemo(() => {
    const m: Record<string, PeriodAllocationDoc[]> = {}
    for (const s of students) m[s.uid] = []
    for (const a of allocations)
      for (const uid of a.crewNeeded)
        if (m[uid]) m[uid].push(a)
    return m
  }, [allocations, students])

  // Group students by production team; anyone not on a team falls into "Unassigned".
  const groups = useMemo(() => {
    const assignedUids = new Set<string>()
    const teamGroups = teams.map(team => {
      const members = students.filter(s => team.memberIds.includes(s.uid))
      members.forEach(s => assignedUids.add(s.uid))
      return { team, members }
    }).filter(g => g.members.length > 0)
    const unassigned = students.filter(s => !assignedUids.has(s.uid))
    return { teamGroups, unassigned }
  }, [teams, students])

  if (students.length === 0) {
    return <p className="text-zinc-500 text-sm text-center py-8">No students in this cohort.</p>
  }

  return (
    <div className="space-y-6">
      {groups.teamGroups.map(({ team, members }) => (
        <div key={team.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{team.emoji}</span>
            <h3 className="text-sm font-semibold" style={{ color: team.color }}>{team.name}</h3>
            <span className="text-xs text-zinc-500">{members.length} member{members.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-3">
            {members.map(s => (
              <StudentRow key={s.uid} student={s} days={byStudent[s.uid] ?? []} colorMap={colorMap} />
            ))}
          </div>
        </div>
      ))}

      {groups.unassigned.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-400">
              {groups.teamGroups.length > 0 ? 'Unassigned' : 'All Students'}
            </h3>
            <span className="text-xs text-zinc-500">{groups.unassigned.length} student{groups.unassigned.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-3">
            {groups.unassigned.map(s => (
              <StudentRow key={s.uid} student={s} days={byStudent[s.uid] ?? []} colorMap={colorMap} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
