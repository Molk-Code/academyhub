import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, getMetadata, deleteObject } from 'firebase/storage'
import { doc, updateDoc, getDoc, increment } from 'firebase/firestore'
import { storage, db } from '@/lib/firebase'
import { SCHOOL_ID } from '@/lib/school'

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  return `${Math.round(b / 1024)} KB`
}

async function assertQuota(fileSizeBytes: number) {
  const snap = await getDoc(doc(db, 'schools', SCHOOL_ID))
  if (!snap.exists()) return
  const data = snap.data()
  const quotaGB = data.storageQuotaGB as number | undefined
  if (!quotaGB) return
  const quota = quotaGB * 1024 * 1024 * 1024
  const used  = (data.storageUsedBytes as number | undefined) ?? 0
  if (used + fileSizeBytes > quota) {
    throw new Error(`Storage limit reached (${fmtBytes(used)} of ${quotaGB} GB used). Delete files or contact your admin.`)
  }
}

async function trackUsage(deltaBytes: number) {
  try {
    await updateDoc(doc(db, 'schools', SCHOOL_ID), {
      storageUsedBytes: increment(deltaBytes),
    })
  } catch {}
}

export async function uploadWithQuota(file: File, storagePath: string): Promise<string> {
  await assertQuota(file.size)
  const fileRef = ref(storage, storagePath)
  const snap = await uploadBytes(fileRef, file)
  const url = await getDownloadURL(snap.ref)
  await trackUsage(file.size)
  return url
}

export async function uploadResumableWithQuota(
  file: File,
  storagePath: string,
  metadata?: object,
  onProgress?: (pct: number) => void,
): Promise<string> {
  await assertQuota(file.size)
  const fileRef = ref(storage, storagePath)
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(fileRef, file, metadata as any)
    task.on(
      'state_changed',
      snap => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref)
          await trackUsage(file.size)
          resolve(url)
        } catch (e) { reject(e) }
      },
    )
  })
}

export async function deleteWithTracking(storagePath: string): Promise<void> {
  const fileRef = ref(storage, storagePath)
  let size = 0
  try {
    const meta = await getMetadata(fileRef)
    size = meta.size ?? 0
  } catch {}
  await deleteObject(fileRef)
  if (size > 0) await trackUsage(-size)
}
