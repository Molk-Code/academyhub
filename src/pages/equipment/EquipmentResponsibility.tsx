import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { useEquipmentResponsibility } from '@/hooks/useEquipmentResponsibility'
import { handlesCategory, OTHER_CATEGORY } from '@/lib/bookingParts'
import type { EquipmentCategoryDoc, EquipmentResponsibility, UserDoc } from '@/types'
import { AlertTriangle, UserCog } from 'lucide-react'

type Mode = 'all' | 'none' | 'some'
const modeOf = (r: EquipmentResponsibility | undefined): Mode => (r === undefined || r === 'all' ? 'all' : r === 'none' ? 'none' : 'some')

// Who handles booking requests for which categories. Each staff member gets
// requests (and can accept/deny/set up) only for their categories; unset = all.
export function BookingResponsibility({ categories }: { categories: EquipmentCategoryDoc[] }) {
  const { map } = useEquipmentResponsibility()
  const [staff, setStaff] = useState<UserDoc[]>([])
  const [savingUid, setSavingUid] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'users'), where('role', 'in', ['teacher', 'admin']))),
      getDocs(query(collection(db, 'users'), where('roles', 'array-contains-any', ['teacher', 'admin']))),
    ]).then(([a, b]) => {
      const m = new Map<string, UserDoc>()
      for (const d of [...a.docs, ...b.docs]) m.set(d.id, { id: d.id, ...d.data() } as UserDoc)
      setStaff([...m.values()].sort((x, y) => (x.displayName ?? '').localeCompare(y.displayName ?? '', 'sv')))
    }).catch(() => {})
  }, [])

  const catNames = useMemo(() => [...categories.map(c => c.name), OTHER_CATEGORY], [categories])

  async function save(uid: string, value: EquipmentResponsibility) {
    setSavingUid(uid)
    try {
      await setDoc(doc(db, 'settings', 'equipment'), { responsibility: { [uid]: value } }, { merge: true })
    } finally {
      setSavingUid(null)
    }
  }

  function setMode(uid: string, mode: Mode) {
    const cur = map[uid]
    if (mode === 'some') save(uid, Array.isArray(cur) ? cur : [])
    else save(uid, mode)
  }

  function toggleCat(uid: string, cat: string) {
    const cur = Array.isArray(map[uid]) ? (map[uid] as string[]) : []
    save(uid, cur.includes(cat) ? cur.filter(c => c !== cat) : [...cur, cat])
  }

  // Categories nobody handles — requests there would only reach admins as a fallback
  const uncovered = catNames.filter(c => staff.length > 0 && !staff.some(u => handlesCategory(map[u.id], c)))

  return (
    <div className="rounded-[14px] border border-[#2a2a3a] bg-[#0e0e16] p-5 space-y-4">
      <div>
        <p className="flex items-center gap-2 font-bold text-[.9rem] text-zinc-100"><UserCog className="w-4 h-4 text-[#4cd964]" /> Booking responsibility</p>
        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
          Choose which categories each staff member handles. They are notified about, and can accept, deny and set up,
          only those parts of a booking. Other parts show greyed out for them.
        </p>
      </div>

      {uncovered.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          Nobody handles {uncovered.join(', ')} — those parts can't be accepted until someone does.
        </p>
      )}

      <div className="divide-y divide-white/5">
        {staff.map(u => {
          const r = map[u.id]
          const mode = modeOf(r)
          return (
            <div key={u.id} className={cn('py-3 space-y-2', savingUid === u.id && 'opacity-60')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-zinc-200 min-w-0 truncate">{u.displayName}</p>
                <div className="flex rounded-lg border border-white/10 overflow-hidden text-xs font-semibold">
                  {(['all', 'some', 'none'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(u.id, m)}
                      className={cn('px-3 py-1.5 transition-colors', mode === m ? 'bg-[#4cd964]/20 text-[#4cd964]' : 'text-zinc-500 hover:bg-white/5')}
                    >
                      {m === 'all' ? 'All' : m === 'some' ? 'Selected' : 'None'}
                    </button>
                  ))}
                </div>
              </div>
              {mode === 'some' && (
                <div className="flex flex-wrap gap-1.5">
                  {catNames.map(c => {
                    const on = (r as string[]).includes(c)
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCat(u.id, c)}
                        className={cn(
                          'text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors',
                          on ? 'bg-[#4cd964]/15 border-[#4cd964]/40 text-[#4cd964]' : 'border-white/10 text-zinc-500 hover:text-zinc-300',
                        )}
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
