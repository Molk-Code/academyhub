import { BrowserMultiFormatReader } from '@zxing/browser'
import { barcodeHints } from './scanHints'

// Camera scanning for equipment, shared by the project page ("This Device")
// and the phone scanner (/scan). Two modes:
//   qr       — QR codes, exactly as before
//   barcode  — 1D barcodes: our Code 128 / GS1-128 labels and manufacturers'
//              EAN/UPC codes. Thin bars need more pixels than a QR code, so
//              this asks for HD video and continuous focus, and tells ZXing to
//              look only for barcode formats and try harder. Where the browser
//              has a native BarcodeDetector (Chrome on Android) that is used
//              instead: it is much faster and better at small codes.

export type ScanKind = 'qr' | 'barcode'

export interface ScanControls { stop(): void }

const KIND_KEY = 'cameraScanKind'
export function savedScanKind(): ScanKind {
  try { return localStorage.getItem(KIND_KEY) === 'barcode' ? 'barcode' : 'qr' } catch { return 'qr' }
}
export function saveScanKind(kind: ScanKind) {
  try { localStorage.setItem(KIND_KEY, kind) } catch { /* private mode */ }
}

const NATIVE_BARCODE_FORMATS = ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'itf']

function constraints(kind: ScanKind): MediaStreamConstraints {
  return kind === 'barcode'
    ? { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }
    : { video: { facingMode: 'environment' }, audio: false }
}

// Continuous autofocus where the camera offers it (most phones; not iOS Safari)
async function focusContinuously(stream: MediaStream) {
  const track = stream.getVideoTracks()[0]
  const caps = (track?.getCapabilities?.() ?? {}) as { focusMode?: string[] }
  if (caps.focusMode?.includes('continuous')) {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
  }
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

/** Start the camera in `video` and call onText for each code read. Throws if the camera can't be opened. */
export async function startCameraScan(video: HTMLVideoElement, kind: ScanKind, onText: (text: string) => void): Promise<ScanControls> {
  if (kind === 'barcode') {
    const detector = await nativeBarcodeDetector()
    if (detector) {
      const stream = await navigator.mediaDevices.getUserMedia(constraints(kind))
      await focusContinuously(stream)
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      video.muted = true
      await video.play()
      let stopped = false, busy = false
      const timer = window.setInterval(async () => {
        if (stopped || busy || video.readyState < 2) return
        busy = true
        try {
          for (const code of await detector.detect(video)) if (code.rawValue) onText(code.rawValue)
        } catch { /* a frame that couldn't be read */ }
        busy = false
      }, 120)
      return {
        stop() {
          stopped = true
          window.clearInterval(timer)
          stream.getTracks().forEach(t => t.stop())
          video.srcObject = null
        },
      }
    }
  }

  // QR mode: exactly the reader used before (all formats, default settings)
  const reader = kind === 'barcode'
    ? new BrowserMultiFormatReader(barcodeHints(), { delayBetweenScanAttempts: 80 })
    : new BrowserMultiFormatReader()
  const controls = await reader.decodeFromConstraints(constraints(kind), video, result => {
    if (result) onText(result.getText())
  })
  if (kind === 'barcode' && video.srcObject instanceof MediaStream) await focusContinuously(video.srcObject)
  return controls
}
