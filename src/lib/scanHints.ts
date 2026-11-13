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
