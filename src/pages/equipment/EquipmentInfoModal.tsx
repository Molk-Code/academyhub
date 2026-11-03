import type { EquipmentDoc, CohortDoc } from '@/types'
import { X, ExternalLink } from 'lucide-react'
import { ImageGallery, equipmentImages } from './ImageGallery'
import { LinkifiedText, externalHref } from './inventoryShared'

export function InfoModal({ item, cohorts, pricingEnabled, onClose }: { item: EquipmentDoc; cohorts: CohortDoc[]; pricingEnabled: boolean; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(8px)', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#0e0e16', border: '1px solid #2a2a3a', borderRadius: 16, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <ImageGallery urls={equipmentImages(item)} name={item.name} />
          <button className="close-btn" onClick={onClose} style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, width: 32, height: 32, background: 'rgba(14,14,22,.85)' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: '1.05rem', color: '#f0f0f5' }}>{item.name}</p>
            <p style={{ fontSize: '.72rem', fontWeight: 700, color: '#4cd964', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 2 }}>{item.category}</p>
          </div>

          <div style={{ fontSize: '.8rem', fontWeight: 600, color: item.available === 0 ? '#ff4757' : '#4cd964' }}>
            {item.available}/{item.totalQuantity} available
            {pricingEnabled && (item.priceInclVat > 0 ? <span style={{ color: '#6a6a80', fontWeight: 500 }}> · {item.priceInclVat} kr/day</span> : <span style={{ color: '#6a6a80', fontWeight: 500 }}> · Free</span>)}
          </div>

          {item.allowedCohortIds && item.allowedCohortIds.length > 0 && (
            <div>
              <p style={{ fontSize: '.7rem', fontWeight: 700, color: '#6a6a80', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Available to classes</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {item.allowedCohortIds.map(id => {
                  const c = cohorts.find(x => x.id === id)
                  return c ? (
                    <span key={id} style={{ fontSize: '.7rem', fontWeight: 700, background: 'rgba(251,191,36,.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.25)', borderRadius: 10, padding: '2px 8px' }}>
                      {c.name}
                    </span>
                  ) : null
                })}
              </div>
            </div>
          )}

          {item.description && (
            <div>
              <p style={{ fontSize: '.7rem', fontWeight: 700, color: '#6a6a80', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Description</p>
              <p style={{ fontSize: '.85rem', color: '#c0c0d5', lineHeight: 1.5, whiteSpace: 'pre-line' }}><LinkifiedText text={item.description} /></p>
            </div>
          )}

          {item.notes && (
            <div>
              <p style={{ fontSize: '.7rem', fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Special Instructions / Notes</p>
              <p style={{ fontSize: '.85rem', color: '#c0c0d5', lineHeight: 1.5, whiteSpace: 'pre-line' }}><LinkifiedText text={item.notes} /></p>
            </div>
          )}

          {item.included?.length > 0 && (
            <div>
              <p style={{ fontSize: '.7rem', fontWeight: 700, color: '#6a6a80', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Included Accessories</p>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {item.included.map((inc, i) => (
                  <li key={i} style={{ fontSize: '.82rem', color: '#a0a0b5', paddingLeft: 12, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: '#4cd964' }}>•</span>{inc}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.location && (
            <p style={{ fontSize: '.78rem', color: '#6a6a80' }}>📍 {item.location}</p>
          )}

          {item.linkUrl && (
            <a
              href={externalHref(item.linkUrl)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', background: 'rgba(242,100,25,.12)', border: '1px solid rgba(242,100,25,.35)', borderRadius: 10, color: '#f26419', fontWeight: 700, fontSize: '.85rem', textDecoration: 'none' }}
            >
              <ExternalLink size={14} /> Product page
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
