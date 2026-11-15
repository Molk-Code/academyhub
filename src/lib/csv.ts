// CSV for spreadsheets and accounting software. 'sv': semicolons and decimal
// commas (Swedish Excel); 'intl': commas and points. UTF-8 with a BOM so
// Excel reads å, ä and ö.

export type CsvFormat = 'sv' | 'intl'

export type CsvValue = string | number | boolean | null | undefined

export function toCsv(rows: CsvValue[][], format: CsvFormat): string {
  const sep = format === 'sv' ? ';' : ','
  const cell = (v: CsvValue) => {
    const s = v == null ? '' : typeof v === 'number' ? (format === 'sv' ? String(v).replace('.', ',') : String(v))
      : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v
    return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + rows.map(r => r.map(cell).join(sep)).join('\r\n') + '\r\n'
}

export function downloadFile(name: string, content: string | Blob, type = 'text/csv;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A name safe in a file name: letters, digits and dashes */
export const fileSlug = (s: string, max = 40) =>
  s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, max) || 'untitled'
