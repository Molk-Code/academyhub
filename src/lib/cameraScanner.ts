import { BrowserMultiFormatReader } from '@zxing/browser'
import { barcodeHints, barcodeCrop } from './scanHints'

// Camera scanning for equipment, shared by the project page ("This Device")
// and the phone scanner (/scan). Two modes:
//   qr       — QR codes, exactly as before
//   barcode  — 1D barcodes: our Code 128 / GS1-128 labels and manufacturers'
//              EAN/UPC codes. Thin bars need many pixels, and a phone's main
//              camera can't focus closer than about 15–20 cm, so the code
//              can't simply be held close. Instead this asks for the highest
//              video resolution, zooms in 2× where the camera allows it, and
//              decodes only the band around the on-screen guide at full
//              detail (barcodeCrop). The native BarcodeDetector (Chrome on
//              Android) is used where there is one; ZXing otherwise (iPhone).

export type ScanKind = 'qr' | 'barcode'

export interface ZoomControl { min: number; max: number; value: number; set(value: number): Promise<number> }
export interface ScanControls { stop(): void; zoom?: ZoomControl }

const KIND_KEY = 'cameraScanKind'
export function savedScanKind(): ScanKind {
  try { return localStorage.getItem(KIND_KEY) === 'barcode' ? 'barcode' : 'qr' } catch { return 'qr' }
}
export function saveScanKind(kind: ScanKind) {
  try { localStorage.setItem(KIND_KEY, kind) } catch { /* private mode */ }
}

const NATIVE_BARCODE_FORMATS = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'itf']
const BARCODE_ZOOM = 2        // default zoom in barcode mode, where the camera supports zoom
const MAX_DECODE_WIDTH = 2400 // px; wider crops are scaled down to keep each attempt quick

const QR_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: 'environment' }, audio: false }
const BARCODE_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
  audio: false,
}

// Continuous autofocus where the camera offers it (most Android phones; not iOS Safari)
async function focusContinuously(track: MediaStreamTrack) {
  const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[] }
  if (caps.focusMode?.includes('continuous')) {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
  }
}

// Camera zoom, where the browser exposes it (Chrome on Android, recent Safari)
async function zoomControl(track: MediaStreamTrack, initial: number): Promise<ZoomControl | undefined> {
  const caps = (track.getCapabilities?.() ?? {}) as { zoom?: { min: number; max: number } }
  if (!caps.zoom || !(caps.zoom.max > caps.zoom.min)) return undefined
  const { min, max } = caps.zoom
  const control: ZoomControl = {
    min, max, value: min,
    async set(value) {
      const v = Math.min(max, Math.max(min, value))
      try {
        await track.applyConstraints({ advanced: [{ zoom: v } as MediaTrackConstraintSet] })
        control.value = v
      } catch { /* keep the current zoom */ }
      return control.value
    },
  }
  await control.set(initial)
  return control
}

type NativeDetector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
async function nativeBarcodeDetector(): Promise<NativeDetector | null> {
  const BD = (window as any).BarcodeDetector
  if (!BD?.getSupportedFormats) return null
  try {
    const supported: string[] = await BD.getSupportedFormats()
    const formats = NATIVE_BARCODE_FORMATS.filter(f => supported.includes(f))
    return formats.includes('code_128') ? new BD({ formats }) : null
  } catch { return null }
}

async function startBarcodeScan(video: HTMLVideoElement, onText: (text: string) => void): Promise<ScanControls> {
  const stream = await navigator.mediaDevices.getUserMedia(BARCODE_CONSTRAINTS)
  const track = stream.getVideoTracks()[0]
  try {
    await focusContinuously(track)
    const zoom = await zoomControl(track, BARCODE_ZOOM)
    video.srcObject = stream
    video.setAttribute('playsinline', 'true')
    video.muted = true
    await video.play()

    const detector = await nativeBarcodeDetector()
    const reader = detector ? null : new BrowserMultiFormatReader(barcodeHints())
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    let stopped = false
    let timer = 0

    const attempt = async () => {
      if (stopped) return
      if (video.readyState >= 2 && video.videoWidth) {
        const c = barcodeCrop(video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight)
        const k = Math.min(1, MAX_DECODE_WIDTH / c.sw)
        canvas.width = Math.round(c.sw * k)
        canvas.height = Math.round(c.sh * k)
        ctx.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, canvas.width, canvas.height)
        try {
          if (detector) {
            for (const code of await detector.detect(canvas)) if (code.rawValue) onText(code.rawValue)
          } else {
            onText(reader!.decodeFromCanvas(canvas).getText())
          }
        } catch { /* nothing readable in this frame */ }
      }
      if (!stopped) timer = window.setTimeout(attempt, 80)
    }
    attempt()

    return {
      zoom,
      stop() {
        stopped = true
        window.clearTimeout(timer)
        stream.getTracks().forEach(t => t.stop())
        video.srcObject = null
      },
    }
  } catch (e) {
    stream.getTracks().forEach(t => t.stop())
    throw e
  }
}

/** Start the camera in `video` and call onText for each code read. Throws if the camera can't be opened. */
export async function startCameraScan(video: HTMLVideoElement, kind: ScanKind, onText: (text: string) => void): Promise<ScanControls> {
  if (kind === 'barcode') return startBarcodeScan(video, onText)
  // QR mode: exactly the reader used before (all formats, default settings)
  return new BrowserMultiFormatReader().decodeFromConstraints(QR_CONSTRAINTS, video, result => {
    if (result) onText(result.getText())
  })
}
