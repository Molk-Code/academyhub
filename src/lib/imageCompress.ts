// Client-side image downsizing so uploads stay under a size limit — the
// Cloudinary image limit (10 MB on our plan) by default, or e.g. the 5 MB
// avatar limit in storage.rules. Images under the limit pass through
// untouched; larger ones are re-encoded as JPEG, stepping quality and then
// resolution down until they fit.

export const MAX_IMAGE_BYTES  = 10 * 1024 * 1024  // Cloudinary image uploads
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024   // storage.rules: avatars/{uid}

// Aim a little under the hard limit so request overhead never tips it over.
const HEADROOM_BYTES = 256 * 1024
const QUALITIES = [0.9, 0.82, 0.74, 0.65]
const MIN_LONG_SIDE = 800

type Drawable = ImageBitmap | HTMLImageElement

async function decode(file: File): Promise<Drawable> {
  try {
    // Honour the camera's EXIF rotation so phone photos aren't sideways
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Fallback via <img> — e.g. Safari can show HEIC that createImageBitmap rejects
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

function encode(src: Drawable, longSide: number, quality: number): Promise<Blob | null> {
  const w0 = 'naturalWidth' in src ? src.naturalWidth : src.width
  const h0 = 'naturalHeight' in src ? src.naturalHeight : src.height
  const scale = Math.min(1, longSide / Math.max(w0, h0))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w0 * scale)
  canvas.height = Math.round(h0 * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  // JPEG has no transparency — give transparent PNGs the app background, not black
  ctx.fillStyle = '#10141a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/**
 * Returns `file` unchanged if it's under `maxBytes`, otherwise a JPEG
 * re-encode that fits (at most `maxLongSide` px on its long edge).
 * Throws a user-readable Error if it can't be done.
 */
export async function shrinkImageToLimit(
  file: File,
  { maxBytes = MAX_IMAGE_BYTES, maxLongSide = 4096 }: { maxBytes?: number; maxLongSide?: number } = {},
): Promise<File> {
  if (file.size < maxBytes) return file
  const target = maxBytes - HEADROOM_BYTES
  const mb = Math.round(maxBytes / (1024 * 1024))

  let src: Drawable
  try {
    src = await decode(file)
  } catch {
    throw new Error(`This image is over ${mb} MB and its format can't be resized in this browser. Please save it as JPG or PNG and try again.`)
  }

  try {
    const w0 = 'naturalWidth' in src ? src.naturalWidth : src.width
    const h0 = 'naturalHeight' in src ? src.naturalHeight : src.height
    let longSide = Math.min(maxLongSide, Math.max(w0, h0))

    while (longSide >= MIN_LONG_SIDE) {
      for (const q of QUALITIES) {
        const blob = await encode(src, longSide, q)
        if (blob && blob.size <= target) {
          const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
          return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
        }
      }
      longSide = Math.round(longSide * 0.8)
    }
  } finally {
    if ('close' in src) src.close()
  }
  throw new Error(`Couldn't shrink this image below ${mb} MB. Please try a smaller image.`)
}
