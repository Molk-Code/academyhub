import { Cloudinary } from '@cloudinary/url-gen'

const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string

export const cld = new Cloudinary({ cloud: { cloudName } })

export function videoUrl(publicId: string): string {
  return `https://res.cloudinary.com/${cloudName}/video/upload/${publicId}`
}

export function thumbnailUrl(publicId: string): string {
  return `https://res.cloudinary.com/${cloudName}/video/upload/so_0,w_640,h_360,c_fill/${publicId}.jpg`
}

// Inject `f_auto,q_auto` into a Cloudinary URL so the browser receives the best-supported
// format (WebP/AVIF/JPG) instead of the raw upload. Fixes cases where PNGs, HEICs, or
// oversized images from admin uploads fail to render in some browsers.
export function optimizeImageUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url
  if (url.includes('/upload/f_auto')) return url
  return url.replace('/upload/', '/upload/f_auto,q_auto/')
}

export async function uploadVideo(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ publicId: string; duration: number; secureUrl: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('upload_preset', uploadPreset)

    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText)
        resolve({
          publicId: data.public_id,
          duration: Math.round(data.duration ?? 0),
          secureUrl: data.secure_url,
        })
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`)
    xhr.send(formData)
  })
}

export async function uploadFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ publicId: string; secureUrl: string; resourceType: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('upload_preset', uploadPreset)

    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText)
        resolve({
          publicId: data.public_id,
          secureUrl: data.secure_url,
          resourceType: data.resource_type,
        })
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    // Use auto resource type to handle images, videos, and raw files
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`)
    xhr.send(formData)
  })
}
