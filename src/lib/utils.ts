import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isToday, isTomorrow, isPast } from 'date-fns'
import type { Timestamp } from 'firebase/firestore'

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert a Firestore Timestamp or Date to a JS Date */
export function toDate(value: Timestamp | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  return value.toDate()
}

/** Human-friendly relative date label */
export function relativeDate(value: Timestamp | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return '—'
  if (isToday(d))    return 'Today'
  if (isTomorrow(d)) return 'Tomorrow'
  if (isPast(d))     return formatDistanceToNow(d, { addSuffix: true })
  return format(d, 'EEE d MMM')
}

/** Short date, e.g. "Mon 12 Jun" */
export function shortDate(value: Timestamp | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return '—'
  return format(d, 'EEE d MMM')
}

/** Time string, e.g. "09:30" */
export function timeStr(value: Timestamp | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return '—'
  return format(d, 'HH:mm')
}

/** Full datetime, e.g. "Mon 12 Jun · 09:30" */
export function fullDateTime(value: Timestamp | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return '—'
  return format(d, "EEE d MMM · HH:mm")
}

/** Percentage clamped 0–100 */
export function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round(Math.min(100, Math.max(0, (numerator / denominator) * 100)))
}

/** Initials from a display name */
export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(n => n[0].toUpperCase())
    .join('')
}

/** Random hue-based avatar colour (deterministic per uid) */
export function avatarColor(uid: string): string {
  const colors = [
    'bg-indigo-500', 'bg-violet-500', 'bg-pink-500',
    'bg-sky-500',    'bg-teal-500',   'bg-emerald-500',
    'bg-amber-500',  'bg-orange-500', 'bg-rose-500',
  ]
  let hash = 0
  for (let i = 0; i < uid.length; i++) hash = uid.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}
