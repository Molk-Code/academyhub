import { describe, it, expect } from 'vitest'
import { matchJumpItems, type JumpItem } from './CommandPalette'

const Icon = () => null
const items: JumpItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: Icon },
  { to: '/admin/equipment', label: 'Equipment', group: 'Rental & inventory', icon: Icon },
  { to: '/admin/inventory', label: 'Inventory', group: 'Rental & inventory', icon: Icon },
  { to: '/admin/email-config', label: 'Email Config', group: 'School & settings', icon: Icon },
]
const labels = (q: string) => matchJumpItems(items, q).map(i => i.label)

describe('matchJumpItems', () => {
  it('lists everything for an empty query', () => expect(labels('  ')).toHaveLength(4))
  it('matches labels and sections, any case', () => {
    expect(labels('INV')).toEqual(['Inventory', 'Equipment'])   // label start first, then the section match
    expect(labels('settings')).toEqual(['Email Config'])
  })
  it('needs every word', () => expect(labels('rental equip')).toEqual(['Equipment']))
  it('finds nothing for an unknown word', () => expect(labels('payroll')).toEqual([]))
})
