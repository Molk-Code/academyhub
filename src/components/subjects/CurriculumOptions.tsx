import type { CurriculumItem } from '@/types'

// <option>s for picking a curriculum topic: one <optgroup> per semester
// (in semester order), topics A–Z within each.
export default function CurriculumOptions({ items }: { items: Pick<CurriculumItem, 'id' | 'title' | 'semester'>[] }) {
  const semesters = Array.from(new Set(items.map(i => i.semester))).sort((a, b) => a - b)
  return (
    <>
      {semesters.map(sem => (
        <optgroup key={sem} label={`Semester ${sem}`}>
          {items
            .filter(i => i.semester === sem)
            .sort((a, b) => a.title.localeCompare(b.title, 'sv'))
            .map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </optgroup>
      ))}
    </>
  )
}
