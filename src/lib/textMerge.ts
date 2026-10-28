// Minimal three-way merge for live co-editing of plain text.
//
// Between saves a person's edits are almost always one contiguous region
// (typing, deleting, pasting), so each side's change is reduced to
// "replace base[start, end) with X". Two such changes merge cleanly when they
// don't overlap; when they do, the local edit wins for that stretch.

interface Change { start: number; end: number; text: string }

function diff(base: string, next: string): Change | null {
  if (base === next) return null
  const max = Math.min(base.length, next.length)
  let p = 0
  while (p < max && base[p] === next[p]) p++
  let s = 0
  while (s < max - p && base[base.length - 1 - s] === next[next.length - 1 - s]) s++
  return { start: p, end: base.length - s, text: next.slice(p, next.length - s) }
}

export function merge3(base: string, local: string, remote: string): string {
  if (local === remote) return local
  const mine = diff(base, local)
  const theirs = diff(base, remote)
  if (!mine) return remote
  if (!theirs) return local
  // Mine is entirely before theirs: remote is unchanged up to theirs.start
  if (mine.end <= theirs.start && !(mine.start === mine.end && mine.start === theirs.start)) {
    return remote.slice(0, mine.start) + mine.text + remote.slice(mine.end)
  }
  // Mine is entirely after theirs: shift by how much theirs grew/shrank
  if (mine.start >= theirs.end) {
    const shift = theirs.text.length - (theirs.end - theirs.start)
    return remote.slice(0, mine.start + shift) + mine.text + remote.slice(mine.end + shift)
  }
  return local
}

// Where a caret at `pos` in `before` should land in `after`.
export function mapCaret(before: string, after: string, pos: number): number {
  const c = diff(before, after)
  if (!c || pos <= c.start) return pos
  if (pos >= c.end) return pos + c.text.length - (c.end - c.start)
  return c.start + c.text.length
}
