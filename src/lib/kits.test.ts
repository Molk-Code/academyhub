import { describe, it, expect } from 'vitest'
import { kitIdFromCode, kitCode, kitCounts, kitsFree, expandKit, mergeLines, wantedPerItem } from './kits'

const kit = { id: 'k1', name: 'FX6 kit', itemIds: ['cam', 'bat', 'bat', 'card'] }
const catalog = new Map([['cam', { name: 'Sony FX6' }], ['bat', { name: 'BP-U70' }], ['card', { name: 'CFexpress' }]])

describe('kits', () => {
  it('reads kit labels', () => {
    expect(kitIdFromCode(kitCode('k1'))).toBe('k1')
    expect(kitIdFromCode(' KIT:abc ')).toBe('abc')
    expect(kitIdFromCode('cam')).toBeNull()
    expect(kitIdFromCode('kit:')).toBeNull()
  })

  it('counts units and whole free kits (the scarcest member decides)', () => {
    expect([...kitCounts(kit)]).toEqual([['cam', 1], ['bat', 2], ['card', 1]])
    const free = { cam: 3, bat: 5, card: 4 } as Record<string, number>
    expect(kitsFree(kit, id => free[id])).toBe(2)
    expect(kitsFree(kit, id => ({ ...free, card: 0 })[id])).toBe(0)
    expect(kitsFree(kit, () => undefined)).toBe(0)
    expect(kitsFree({ itemIds: [] }, () => 9)).toBe(0)
  })

  it('expands to one line per item and merges with other lines', () => {
    const lines = expandKit(kit, 2, catalog)
    expect(lines).toEqual([
      { equipmentId: 'cam', equipmentName: 'Sony FX6', quantity: 2, kitId: 'k1', kitName: 'FX6 kit' },
      { equipmentId: 'bat', equipmentName: 'BP-U70', quantity: 4, kitId: 'k1', kitName: 'FX6 kit' },
      { equipmentId: 'card', equipmentName: 'CFexpress', quantity: 2, kitId: 'k1', kitName: 'FX6 kit' },
    ])
    const merged = mergeLines([...lines, { equipmentId: 'bat', equipmentName: 'BP-U70', quantity: 1 }])
    expect(merged.find(l => l.equipmentId === 'bat')?.quantity).toBe(5)
    expect(merged).toHaveLength(3)
    expect(wantedPerItem(merged).get('bat')).toBe(5)
  })
})
