import { describe, expect, it, vi } from 'vitest'
import JsBarcode from 'jsbarcode'
import { BinaryBitmap, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library'
import { barcodeHints, barcodeCrop } from './scanHints'

vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('@/lib/cloudinary', () => ({ optimizeImageUrl: (u: string) => u }))
const { parseScanText, ean14Value } = await import('@/pages/equipment/inventoryShared')

// Our labels as the camera would see them: JsBarcode's bars (the library the
// label printer uses) drawn into a grey image with a quiet zone and a little
// noise, then read with the barcode mode's ZXing settings.
function decodeLabel(data: string, ean128: boolean, moduleWidth = 3): string {
  const target: { encodings?: { data: string }[] } = {}
  JsBarcode(target, data, { format: 'CODE128', ean128 })
  const bits = target.encodings!.map(e => e.data).join('')
  const quiet = 12 * moduleWidth, width = bits.length * moduleWidth + 2 * quiet, height = 60
  const lum = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = Math.floor((x - quiet) / moduleWidth)
      const bar = x >= quiet && i < bits.length && bits[i] === '1'
      lum[y * width + x] = Math.max(0, Math.min(255, (bar ? 30 : 225) + ((x * 7 + y * 13) % 21) - 10))
    }
  }
  const reader = new MultiFormatReader()
  reader.setHints(barcodeHints())
  return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, width, height)))).getText()
}

describe('camera barcode mode reads our labels', () => {
  it('Code 128 with an item id', () => {
    const text = decodeLabel('aB3dE5fG7hJ9kL1mN2pQ', false)
    expect(parseScanText(text)).toEqual({ base: 'aB3dE5fG7hJ9kL1mN2pQ', unit: null })
  })
  it('Code 128 with an item id and unit number', () => {
    expect(parseScanText(decodeLabel('aB3dE5fG7hJ9kL1mN2pQ.3', false))).toEqual({ base: 'aB3dE5fG7hJ9kL1mN2pQ', unit: 3 })
  })
  it('GS1-128 EAN-14 labels, shared and per unit', () => {
    const shared = parseScanText(decodeLabel(`01${ean14Value(1234, null)}`, true))
    expect(shared).toMatchObject({ gtinNo: 1234, unit: null })
    const unit = parseScanText(decodeLabel(`01${ean14Value(1234, 7)}`, true, 2))
    expect(unit).toMatchObject({ gtinNo: 1234, unit: 7 })
  })
})

describe('barcodeCrop', () => {
  it('landscape frame in a 4:3 box: the visible width, the middle half of the height', () => {
    // 1920×1080 shown in 400×300 with cover → visible 1440×1080
    expect(barcodeCrop(1920, 1080, 400, 300)).toEqual({ sx: 240, sy: 270, sw: 1440, sh: 540 })
  })
  it('portrait frame (phone held upright) in a 4:3 box', () => {
    // 1080×1920 in 400×300 → visible 1080×810
    expect(barcodeCrop(1080, 1920, 400, 300)).toEqual({ sx: 0, sy: 758, sw: 1080, sh: 405 })
  })
  it('hidden video (no size yet): the whole width', () => {
    expect(barcodeCrop(1280, 720, 0, 0)).toEqual({ sx: 0, sy: 180, sw: 1280, sh: 360 })
  })
})
