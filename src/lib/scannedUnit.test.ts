import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }))
const { parseScanText, scannedUnit, ean14Value } = await import('@/pages/equipment/inventoryShared')

// What each printed label holds, unchanged: the plain id, "<id>.<n>" (barcode),
// "<id>::<n>" (QR) or an EAN-14 with the unit in it (000 = no unit)
const ID = 'AbCdEfGhIjKlMnOpQrSt'
const unitOf = (code: string, equip: { plainLabelIsUnit1?: boolean; totalQuantity?: number }) => scannedUnit(equip, parseScanText(code).unit)

describe('scannedUnit: a first label without a number can be unit #1', () => {
  const grown = { plainLabelIsUnit1: true, totalQuantity: 2 }
  const shared = { plainLabelIsUnit1: false, totalQuantity: 10 }

  it('the plain label of an item that grew from one copy is #1', () => {
    expect(unitOf(ID, grown)).toBe(1)
    expect(unitOf(`01${ean14Value(42, null)}`, grown)).toBe(1)
  })
  it('numbered labels keep their own number', () => {
    expect(unitOf(`${ID}.2`, grown)).toBe(2)
    expect(unitOf(`${ID}::2`, grown)).toBe(2)
    expect(unitOf(`${ID}.1`, grown)).toBe(1)
    expect(unitOf(`01${ean14Value(42, 3)}`, grown)).toBe(3)
  })
  it('a shared label stays shared', () => {
    expect(unitOf(ID, shared)).toBeNull()
    expect(unitOf(ID, {})).toBeNull()
  })
  it('a single item has no unit number', () => {
    expect(unitOf(ID, { plainLabelIsUnit1: true, totalQuantity: 1 })).toBeNull()
    expect(scannedUnit(undefined, null)).toBeNull()
  })
})
