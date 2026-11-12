// Suggestions for the class a class continues in next school year: the same
// dates one year on, the year in the name moved up ("Åk 1" → "Åk 2"). The
// admin can change everything before rolling over.
import type { CohortDoc } from '@/types'

// 'YYYY-MM-DD' one year later (29 Feb → 28 Feb)
export function plusOneYear(iso: string | undefined | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const day = m === 2 && d === 29 ? 28 : d
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// "Film Åk 1" → "Film Åk 2", "Year 1 Sound" → "Year 2 Sound"; otherwise unchanged
export function nextClassName(name: string): string {
  // \b doesn't see Å as a letter, and lookbehind needs Safari 16.4: match the character before instead
  return name.replace(/(^|[^\p{L}])(åk|år|year|yr|grade|klass|class|ak)(\s*)1(?!\d)/iu, (_m, pre, word, sp) => `${pre}${word}${sp}2`)
}

const tsIso = (t: CohortDoc['startDate'] | undefined) => (t?.toDate ? t.toDate().toLocaleDateString('sv-SE') : '')

export interface NextClassDraft {
  name: string
  startDate: string
  endDate: string
  programYear: 1 | 2
  semesterStartDate: string
  semesterEndDate: string
  semesterSem2StartDate: string
  semesterSem2EndDate: string
}

export function suggestNextClass(c: CohortDoc): NextClassDraft {
  return {
    name: nextClassName(c.name),
    startDate: plusOneYear(tsIso(c.startDate)),
    endDate: plusOneYear(tsIso(c.endDate)),
    programYear: 2,
    semesterStartDate: plusOneYear(c.semesterStartDate),
    semesterEndDate: plusOneYear(c.semesterEndDate),
    semesterSem2StartDate: plusOneYear(c.semesterSem2StartDate),
    semesterSem2EndDate: plusOneYear(c.semesterSem2EndDate),
  }
}

// Year 2 classes have finished the programme; year 1 classes continue
export const graduatesByDefault = (c: Pick<CohortDoc, 'programYear'>) => c.programYear === 2

// "Copy last year's plan": the usual source is last year's class in the same
// year of the programme, i.e. the most recently archived one
export function lastYearsClass(all: CohortDoc[], target: CohortDoc): CohortDoc | undefined {
  return all
    .filter(c => c.archived && c.id !== target.id && c.programYear === target.programYear)
    .sort((a, b) => (b.archivedAt?.toMillis?.() ?? 0) - (a.archivedAt?.toMillis?.() ?? 0))[0]
}

// Whole weeks between two class starts (keeps weekdays); a year (52 weeks) when unknown
export function defaultShiftWeeks(fromStart?: string, toStart?: string): number {
  if (!fromStart || !toStart) return 52
  const weeks = Math.round((Date.parse(toStart) - Date.parse(fromStart)) / (7 * 86_400_000))
  return weeks > 0 ? weeks : 52
}
