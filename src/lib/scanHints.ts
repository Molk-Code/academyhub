import { BarcodeFormat, DecodeHintType } from '@zxing/library'

// ZXing settings for the camera's barcode mode (see cameraScanner.ts). Kept
// apart from the camera code so they can be tested without a browser.
export const BARCODE_FORMATS = [
  BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
]

export function barcodeHints(): Map<DecodeHintType, unknown> {
  return new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS],
    [DecodeHintType.TRY_HARDER, true],
  ])
}

export interface CropRect { sx: number; sy: number; sw: number; sh: number }

/** Share of the visible picture's height that is decoded: the barcode guide (28 %) plus some slack. */
export const BARCODE_BAND = 0.5

/**
 * The part of a video frame (vw × vh) to decode in barcode mode: the band
 * around the on-screen guide. The <video> (elW × elH) shows the frame with
 * object-fit: cover, so first find the visible part, then take the full
 * visible width and the middle BARCODE_BAND of its height. Decoding only this
 * band keeps every pixel of detail (a code held further away still has enough
 * pixels per bar) while each attempt stays fast.
 */
export function barcodeCrop(vw: number, vh: number, elW: number, elH: number): CropRect {
  let visW = vw, visH = vh
  if (elW > 0 && elH > 0) {
    const scale = Math.max(elW / vw, elH / vh)
    visW = Math.min(vw, elW / scale)
    visH = Math.min(vh, elH / scale)
  }
  const sw = Math.round(visW), sh = Math.round(visH * BARCODE_BAND)
  return { sx: Math.round((vw - sw) / 2), sy: Math.round((vh - sh) / 2), sw, sh }
}
