import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Package } from 'lucide-react'
import { optimizeImageUrl } from '@/lib/cloudinary'
import type { EquipmentDoc } from '@/types'

// All of an item's images, main image first. Older items only have imageUrl.
export function equipmentImages(item: Pick<EquipmentDoc, 'imageUrl' | 'imageUrls'>): string[] {
  if (item.imageUrls?.length) return item.imageUrls
  return item.imageUrl ? [item.imageUrl] : []
}

const ARROW: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 34, height: 34, borderRadius: '50%',
  border: 'none', background: 'rgba(14,14,22,.75)', color: '#fff', display: 'flex', alignItems: 'center',
  justifyContent: 'center', cursor: 'pointer', zIndex: 1,
}

// Swipeable image strip (scroll-snap) with arrows and dots for more than one image.
export function ImageGallery({ urls, name, height = 'min(45vh, 340px)' }: { urls: string[]; name: string; height?: string }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  if (urls.length === 0) {
    return (
      <div style={{ height: 220, background: '#1a1a25', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a3a4a' }}>
        <Package size={40} />
      </div>
    )
  }

  function go(i: number) {
    const el = stripRef.current
    if (!el) return
    const next = (i + urls.length) % urls.length
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
    setIndex(next)
  }

  return (
    <div
      style={{ position: 'relative', background: '#fff' }}
      tabIndex={urls.length > 1 ? 0 : undefined}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1) }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1) }
      }}
    >
      <div
        ref={stripRef}
        onScroll={e => {
          const el = e.currentTarget
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth))
          if (i !== index) setIndex(i)
        }}
        style={{ display: 'flex', overflowX: urls.length > 1 ? 'auto' : 'hidden', scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}
      >
        {urls.map((url, i) => (
          <div key={url + i} style={{ flex: '0 0 100%', height, scrollSnapAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              src={optimizeImageUrl(url)}
              alt={`${name} — image ${i + 1} of ${urls.length}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
        ))}
      </div>

      {urls.length > 1 && (
        <>
          <button type="button" aria-label="Previous image" onClick={() => go(index - 1)} style={{ ...ARROW, left: 8 }}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Next image" onClick={() => go(index + 1)} style={{ ...ARROW, right: 8 }}><ChevronRight size={18} /></button>
          <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>
            {urls.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Image ${i + 1}`}
                onClick={() => go(i)}
                style={{ width: i === index ? 18 : 8, height: 8, borderRadius: 4, border: 'none', padding: 0, cursor: 'pointer', transition: 'width .2s', background: i === index ? '#f26419' : 'rgba(0,0,0,.3)' }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
