import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collectionGroup, getDocs } from 'firebase/firestore'
import { UserRound, Globe, BookOpen } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { useCollection, useDocument } from '@/hooks/useFirestore'
import { cn } from '@/lib/utils'
import type { CohortDoc, GuestTeacherDoc, SubjectDoc, SubjectTeacherDoc } from '@/types'
import LoadingSpinner from '@/components/common/LoadingSpinner'

const PANEL = 'rounded-2xl bg-zinc-900 border border-white/[0.06] shadow-xl'

interface GuestEntry {
  key: string
  name: string
  title: string
  bio: string
  imageUrl: string | null
  portfolioUrl: string | null
  subjects: { id: string; title: string }[]
}

// Every guest teacher added to the student's subjects, one card per person
// (the same guest on several subjects is listed once, with all subjects).
export default function GuestTeachers() {
  const { cohortId, previewCohortId } = useAuth()
  const effectiveCohortId = previewCohortId ?? cohortId
  const { data: cohort } = useDocument<CohortDoc>('cohorts', effectiveCohortId ?? undefined)
  const { data: allSubjects, loading: subjectsLoading } = useCollection<SubjectDoc>('subjects')
  // Library profiles fill in bio/photo/portfolio a subject entry may lack
  const { data: library } = useCollection<GuestTeacherDoc>('guest_teachers')

  const [guestRows, setGuestRows] = useState<{ subjectId: string; t: SubjectTeacherDoc }[] | null>(null)
  useEffect(() => {
    getDocs(collectionGroup(db, 'teachers'))
      .then(snap => {
        const rows: { subjectId: string; t: SubjectTeacherDoc }[] = []
        for (const d of snap.docs) {
          const parent = d.ref.parent.parent
          if (!parent || parent.parent.id !== 'subjects') continue
          const t = { ...(d.data() as SubjectTeacherDoc), id: d.id }
          if (t.isGuest) rows.push({ subjectId: parent.id, t })
        }
        setGuestRows(rows)
      })
      .catch(() => setGuestRows([]))
  }, [])

  const guests = useMemo(() => {
    const subjects = new Map(allSubjects
      .filter(s => !cohort || s.programYear === cohort.programYear)
      .map(s => [s.id, s]))
    const libById = new Map(library.map(g => [g.id, g]))
    const byKey = new Map<string, GuestEntry>()
    for (const { subjectId, t } of guestRows ?? []) {
      const subject = subjects.get(subjectId)
      if (!subject) continue
      const lib = t.guestTeacherId ? libById.get(t.guestTeacherId) : undefined
      const name = (t.name || lib?.name || '').trim()
      if (!name) continue
      const key = t.guestTeacherId ?? name.toLowerCase()
      const entry = byKey.get(key) ?? {
        key, name, title: '', bio: '', imageUrl: null, portfolioUrl: null, subjects: [],
      }
      entry.title        ||= t.title || lib?.expertise?.join(', ') || ''
      entry.bio          ||= t.description || lib?.bio || ''
      entry.imageUrl     ??= t.imageUrl || lib?.profilePictureUrl || null
      entry.portfolioUrl ??= t.portfolioUrl || lib?.portfolioUrl || null
      if (!entry.subjects.some(s => s.id === subjectId)) {
        entry.subjects.push({ id: subjectId, title: subject.title })
      }
      byKey.set(key, entry)
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  }, [allSubjects, cohort, library, guestRows])

  if (subjectsLoading || guestRows === null) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Guest Teachers</h1>
        <p className="text-sm text-zinc-400 mt-1">The industry professionals teaching on your subjects.</p>
      </div>

      {guests.length === 0 ? (
        <div className={cn(PANEL, 'text-center py-14 text-zinc-400')}>
          <p className="text-sm">No guest teachers have been added to your subjects yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {guests.map(g => (
            <article key={g.key} className={cn(PANEL, 'p-5 flex flex-col')}>
              <div className="flex items-center gap-4">
                {g.imageUrl ? (
                  <img src={g.imageUrl} alt={g.name} className="w-20 h-20 rounded-full object-cover ring-2 ring-white/10 flex-shrink-0" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center ring-2 ring-white/10 flex-shrink-0">
                    <UserRound className="w-9 h-9 text-zinc-500" />
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="font-semibold text-base text-zinc-100">{g.name}</h2>
                  {g.title && <p className="text-xs text-brand-300 font-medium mt-0.5">{g.title}</p>}
                </div>
              </div>

              {g.bio && <p className="text-sm text-zinc-400 mt-4 leading-relaxed whitespace-pre-line">{g.bio}</p>}

              <div className="mt-auto pt-4 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {g.subjects.map(s => (
                    <Link
                      key={s.id}
                      to={`/subjects/${s.id}`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-white/5 px-2 py-1 rounded-lg"
                    >
                      <BookOpen className="w-3 h-3" /> {s.title}
                    </Link>
                  ))}
                </div>
                {g.portfolioUrl && (
                  <a
                    href={/^https?:\/\//i.test(g.portfolioUrl) ? g.portfolioUrl : `https://${g.portfolioUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-400 hover:text-brand-300"
                  >
                    <Globe className="w-3.5 h-3.5" /> Portfolio
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
