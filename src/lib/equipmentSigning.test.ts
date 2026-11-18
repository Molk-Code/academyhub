import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/firebase', () => ({ functions: {} }))
import { signatureState } from './equipmentSigning'
import type { EquipmentSignatureDoc, InventoryProjectDoc } from '@/types'

const project = { id: 'p', name: 'Film', checkoutDate: '2026-11-01', returnDate: '2026-11-10', borrowerIds: ['a', 'b'] } as unknown as InventoryProjectDoc
const sent = { ...project, signatureRequest: { requestedBy: 's', requestedByName: 'Staff' } }

describe('signatureState', () => {
  it('nobody is asked before the contract is sent', () => {
    expect(signatureState(project, [], undefined, 'a')).toBe('not-requested')
  })
  it('a borrower added after sending is not asked until it is sent again', () => {
    const p = { ...sent, pendingSignatureUids: ['a'] }
    expect(signatureState(p, [], undefined, 'a')).toBe('requested')
    expect(signatureState(p, [], undefined, 'c')).toBe('not-requested')
  })
  it('older projects without the pending list: everyone once sent', () => {
    expect(signatureState(sent, [], undefined, 'c')).toBe('requested')
  })
  it('a signature that still matches is signed', () => {
    const sig = { uid: 'a', snapshot: { projectName: 'Film', dateFrom: '2026-11-01', dateTo: '2026-11-10', items: [] } } as unknown as EquipmentSignatureDoc
    expect(signatureState({ ...sent, pendingSignatureUids: [] }, [], sig, 'a')).toBe('signed')
  })
})
