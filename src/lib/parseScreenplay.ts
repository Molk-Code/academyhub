export interface ParsedScene {
  sceneNumber: number
  intExt: 'INT' | 'EXT'
  location: string
  dayNight: 'Day' | 'Night'
  headingRaw: string
}

// Matches any line starting with (optional scene number +) INT./EXT.
// The scene number prefix may be terminated by a period, colon, or just
// whitespace (e.g. "1.", "1:", "1 " all seen in the wild).
const HEADING_START_RE = /^(?:[\d.]+[.:]?\s+)?(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?)\s+(.+)/i

const TIME_WORDS = 'DAY|NIGHT|DAWN|DUSK|SUNDOWN|SUNSET|SUNRISE|CONTINUOUS|LATER|MOMENTS LATER|KVÄLL|MORGON|DAG|NATT|EFTERMIDDAG'
const TIME_FIRST_RE = new RegExp(`^(${TIME_WORDS})[,\\s]+(.+)`, 'i')
const TIME_LAST_RE  = new RegExp(`^(.+?)\\s*[-–—]+\\s*(${TIME_WORDS})\\b.*$`, 'i')

function normalizeIntExt(raw: string): 'INT' | 'EXT' {
  return raw.toUpperCase().startsWith('INT') ? 'INT' : 'EXT'
}

function normalizeDayNight(raw: string): 'Day' | 'Night' {
  const up = raw.toUpperCase()
  return ['NIGHT', 'DUSK', 'SUNDOWN', 'SUNSET', 'KVÄLL', 'NATT'].includes(up) ? 'Night' : 'Day'
}

function parseRemainder(remainderRaw: string): { location: string; dayNight: 'Day' | 'Night' } {
  // Some screenplay formats separate INT./EXT. from the location with a
  // dash (e.g. "INT. — KITCHEN — DAY") rather than just a space — strip it.
  const remainder = remainderRaw.replace(/^[-–—]+\s*/, '')
  const first = remainder.match(TIME_FIRST_RE)
  if (first) return { location: first[2].trim(), dayNight: normalizeDayNight(first[1]) }

  const last = remainder.match(TIME_LAST_RE)
  if (last) return { location: last[1].trim(), dayNight: normalizeDayNight(last[2]) }

  return { location: remainder.trim(), dayNight: 'Day' }
}

// Reconstruct text lines from pdfjs items using their x/y positions.
// This handles PDFs where characters are stored individually (common in
// compact/monospaced screenplay PDFs) which naive join('\n') breaks.
function extractLines(items: any[]): string[] {
  if (items.length === 0) return []

  // Group items by y-position (with tolerance for same-line glyphs)
  const Y_TOL = 3
  const groups: Array<{ y: number; items: Array<{ x: number; str: string; width: number }> }> = []

  for (const item of items) {
    if (!('str' in item) || !item.str) continue
    const [, , , , x, y] = item.transform as number[]
    const group = groups.find(g => Math.abs(g.y - y) <= Y_TOL)
    if (group) {
      group.items.push({ x, str: item.str, width: item.width ?? 0 })
    } else {
      groups.push({ y, items: [{ x, str: item.str, width: item.width ?? 0 }] })
    }
  }

  // Sort groups top-to-bottom (PDF y-axis is bottom-up)
  groups.sort((a, b) => b.y - a.y)

  return groups.map(group => {
    group.items.sort((a, b) => a.x - b.x)

    // Join items, inserting a space when there's a meaningful horizontal gap
    let line = ''
    let prevRight = -Infinity
    for (const item of group.items) {
      const gap = item.x - prevRight
      // A gap wider than ~1/3 of a character width indicates a word space
      if (prevRight !== -Infinity && gap > 1) line += ' '
      line += item.str
      prevRight = item.x + item.width
    }
    return line.trim()
  })
}

// pdfjs normally hands text extraction off to a real Web Worker, talking to
// it over postMessage. Its own worker→main-thread fallback only kicks in on
// an explicit Worker 'error' event or a thrown exception — if the worker
// script loads but its ready/test handshake message never arrives (seen in
// some browser/CSP combinations), getDocument() just hangs forever with no
// error at all. Screenplay PDFs are small and parsing them is fast (well
// under a second even on the main thread), so there's no real upside to the
// worker here — importing its module directly and registering it as
// pdfjs's "main-thread worker" (a documented hook, normally used for
// Node.js) skips the real Worker and the postMessage handshake entirely,
// removing that whole failure mode.
let mainThreadWorkerReady: Promise<void> | null = null
function ensureMainThreadWorker(): Promise<void> {
  if (!mainThreadWorkerReady) {
    mainThreadWorkerReady = import(
      /* @vite-ignore */
      new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    ).then(workerModule => {
      ;(globalThis as any).pdfjsWorker = workerModule
    })
  }
  return mainThreadWorkerReady
}

// Safety net in case the above still ends up slow/stuck for some reason —
// parsing should always settle, successfully or not.
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error('Screenplay parsing timed out'))
    }, ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

export async function parseScreenplayPDF(file: File): Promise<ParsedScene[]> {
  const pdfjsLib = await import('pdfjs-dist')
  await ensureMainThreadWorker()

  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await withTimeout(loadingTask.promise, 20000, () => loadingTask.destroy())

  const lines: string[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    lines.push(...extractLines(content.items))
  }

  const scenes: ParsedScene[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(HEADING_START_RE)
    if (match) {
      const { location, dayNight } = parseRemainder(match[2])
      scenes.push({
        sceneNumber: scenes.length + 1,
        intExt: normalizeIntExt(match[1]),
        location,
        dayNight,
        headingRaw: trimmed,
      })
    }
  }

  return scenes
}
