import { describe, it, expect } from 'vitest'
import { serviceState, needsService } from './maintenance'

describe('maintenance', () => {
  const today = '2026-11-15'
  it('classifies items', () => {
    expect(serviceState({ maintenanceUnits: 1, nextServiceDate: '2027-01-01' }, today)).toBe('in-service')
    expect(serviceState({ nextServiceDate: '2026-11-15' }, today)).toBe('overdue')
    expect(serviceState({ nextServiceDate: '2026-12-10' }, today)).toBe('due-soon')
    expect(serviceState({ nextServiceDate: '2027-02-01' }, today)).toBeNull()
    expect(serviceState({}, today)).toBeNull()
  })
  it('counts what needs attention now, active items only', () => {
    expect(needsService([
      { maintenanceUnits: 2 }, { nextServiceDate: '2026-11-01' }, { nextServiceDate: '2026-12-01' },
      { nextServiceDate: '2026-11-01', isActive: false }, {},
    ], today)).toBe(2)
  })
})
