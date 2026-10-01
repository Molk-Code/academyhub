import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, getMetadata, deleteObject } from 'firebase/storage'
import { doc, updateDoc, getDoc, increment } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { storage, db, functions } from '@/lib/firebase'
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

function readFileAsBase64(file: File, onReadProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = e => {
      if (e.lengthComputable) onReadProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.onload = () => {
      const result = reader.result as string
      // Strip the "data:application/pdf;base64," prefix
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

// Authorization (owner/collaborator/staff) is checked server-side by the
// uploadScreenplay callable via the Admin SDK, which then writes the file
// directly — bypassing Storage Rules' write path entirely. This exists
// because that write path's cross-service firestore.get() call (needed to
// check production ownership) fails for plain student accounts, even though
// it works for staff (whose role claim short-circuits isTeacherOrAdmin()
// before the cross-service call ever runs).
export async function uploadScreenplayViaFunction(
  file: File,
  productionId: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  await assertQuota(file.size)

  // Reading+encoding the file is the only phase we can report real progress
  // for; the network call to the function has no progress API, so it's
  // reported as a single jump to 100 on completion.
  const fileBase64 = await readFileAsBase64(file, pct => onProgress?.(Math.round(pct * 0.6)))
  onProgress?.(65)

  const upload = httpsCallable<{ productionId: string; fileBase64: string }, { path: string }>(
    functions, 'uploadScreenplay',
  )
  const { data } = await upload({ productionId, fileBase64 })

  onProgress?.(90)
  const url = await getDownloadURL(ref(storage, data.path))
  await trackUsage(file.size)
  onProgress?.(100)
  return url
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
