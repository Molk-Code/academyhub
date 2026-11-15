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

describe('maintenance: units and next service', () => {
  it('adds months, clamped to the month end', async () => {
    const { addMonths, suggestedNextService } = await import('./maintenance')
    expect(addMonths('2026-11-15', 6)).toBe('2027-05-15')
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2027-12-10', 12)).toBe('2028-12-10')
    expect(suggestedNextService({ serviceIntervalMonths: 3 }, '2026-11-15')).toBe('2027-02-15')
    expect(suggestedNextService({}, '2026-11-15')).toBe('')
  })
  it('sends units away and brings them back, by number', async () => {
    const { sendToService, backFromService, serviceFields } = await import('./maintenance')
    let u = sendToService([], 3, ' Sensor cleaning ', '2026-11-15')
    u = sendToService(u, 1, '', '2026-11-16')
    expect(u).toEqual([{ unit: 1, since: '2026-11-16' }, { unit: 3, since: '2026-11-15', note: 'Sensor cleaning' }])
    expect(sendToService(u, 3, 'again', '2026-11-17').filter(x => x.unit === 3)).toHaveLength(1)
    expect(backFromService(u, 3)).toEqual([{ unit: 1, since: '2026-11-16' }])
    expect(backFromService(u, null)).toEqual([])
    expect(serviceFields(u)).toMatchObject({ maintenanceUnits: 2 })
  })
})
