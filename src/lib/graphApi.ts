// Microsoft Graph API helpers — all calls use a bearer token from MSAL

const GRAPH = 'https://graph.microsoft.com/v1.0'

export interface DriveItem {
  id: string
  name: string
  size?: number
  lastModifiedDateTime: string
  folder?: { childCount: number }
  file?: { mimeType: string }
  '@microsoft.graph.downloadUrl'?: string
  webUrl?: string
  parentReference?: { path: string }
}

async function graphFetch(token: string, path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${GRAPH}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? `Graph API error ${res.status}`)
  }
  return res
}

export async function listChildren(
  token: string,
  siteId: string,
  folderPath: string,
): Promise<DriveItem[]> {
  const encoded = encodeURIComponent(folderPath)
  const res = await graphFetch(token, `/sites/${siteId}/drive/root:/${encoded}:/children?$top=200`)
  const json = await res.json()
  return (json.value ?? []) as DriveItem[]
}

export async function uploadFile(
  token: string,
  siteId: string,
  folderPath: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<DriveItem> {
  const encoded = encodeURIComponent(`${folderPath}/${file.name}`)

  if (file.size <= 4 * 1024 * 1024) {
    const res = await fetch(`${GRAPH}/sites/${siteId}/drive/root:/${encoded}:/content`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error?.message ?? `Upload failed ${res.status}`)
    }
    onProgress?.(100)
    return res.json()
  }

  // Large file: upload session
  const sessionRes = await graphFetch(token, `/sites/${siteId}/drive/root:/${encoded}:/createUploadSession`, {
    method: 'POST',
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  })
  const { uploadUrl } = await sessionRes.json()

  const chunkSize = 5 * 1024 * 1024
  let offset = 0
  let item: DriveItem | null = null
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize)
    const end = Math.min(offset + chunkSize - 1, file.size - 1)
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes ${offset}-${end}/${file.size}`,
        'Content-Length': String(chunk.size),
      },
      body: chunk,
    })
    if (res.status === 201 || res.status === 200) item = await res.json()
    offset += chunkSize
    onProgress?.(Math.round((offset / file.size) * 100))
  }
  return item!
}

export async function createFolder(
  token: string,
  siteId: string,
  folderPath: string,
  name: string,
): Promise<DriveItem> {
  const encoded = encodeURIComponent(folderPath)
  const res = await graphFetch(token, `/sites/${siteId}/drive/root:/${encoded}:/children`, {
    method: 'POST',
    body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  })
  return res.json()
}

export async function deleteItem(
  token: string,
  siteId: string,
  itemId: string,
): Promise<void> {
  await fetch(`${GRAPH}/sites/${siteId}/drive/items/${itemId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function resolveSiteId(token: string, siteUrl: string): Promise<string> {
  const url = new URL(siteUrl)
  const hostname = url.hostname
  const path = url.pathname
  const res = await graphFetch(token, `/sites/${hostname}:${path}`)
  const json = await res.json()
  return json.id as string
}

export async function getItemDetails(
  token: string,
  siteId: string,
  itemId: string,
): Promise<DriveItem> {
  const res = await graphFetch(
    token,
    `/sites/${siteId}/drive/items/${itemId}?$select=id,name,size,lastModifiedDateTime,file,folder,@microsoft.graph.downloadUrl,webUrl`,
  )
  return res.json()
}

export async function getItemThumbnail(
  token: string,
  siteId: string,
  itemId: string,
): Promise<string | null> {
  try {
    const res = await graphFetch(token, `/sites/${siteId}/drive/items/${itemId}/thumbnails/0/large`)
    const json = await res.json()
    return json.url ?? null
  } catch {
    return null
  }
}

export function fileIcon(item: DriveItem): string {
  if (item.folder) return '📁'
  const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    ppt: '📊', pptx: '📊', txt: '📄', md: '📄',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬',
    mp3: '🎵', wav: '🎵', aac: '🎵',
    zip: '🗜️', rar: '🗜️', '7z': '🗜️',
    ai: '🎨', psd: '🎨', eps: '🎨',
    pr: '🎞️', ppro: '🎞️', aep: '🎞️',
  }
  return map[ext] ?? '📎'
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
