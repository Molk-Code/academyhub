import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/firebase', () => ({ db: {} }))
import { borrowerIdsFor } from './BorrowerPicker'
import type { UserDoc } from '@/types'

const u = (id: string, displayName: string) => ({ id, displayName } as UserDoc)
const candidates = { students: [u('s1', 'Alva'), u('s2', 'Bo')], teachers: [u('t1', 'Cecilia')] }

describe('borrowerIdsFor', () => {
  it('adds the ids of picked people; typed names get none', () => {
    expect(borrowerIdsFor(['Alva', 'Guest Person'], candidates)).toEqual(['s1'])
  })
  it('removing someone drops their id; others stay', () => {
    expect(borrowerIdsFor(['Bo'], candidates, ['s1', 's2'])).toEqual(['s2'])
  })
  it('keeps ids it cannot look up (e.g. an account no longer listed)', () => {
    expect(borrowerIdsFor(['Alva', 'Cecilia'], candidates, ['gone', 's1']).sort()).toEqual(['gone', 's1', 't1'])
  })
})
