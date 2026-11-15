import { describe, expect, it } from 'vitest'
import { localDay, localInstant, nextDay, toLocalInput } from '../../src/lib/time'
import { medicationInput } from '../../src/lib/validation'
import { demoData, demoHandoff } from '../../src/lib/demo'

describe('local schedules', () => {
  it('assigns an India midnight dose to the correct civil date', () => {
    const at = localInstant('2026-11-15', '00:15', 'Asia/Kolkata')
    expect(new Date(at).toISOString()).toBe('2026-11-14T18:45:00.000Z')
    expect(localDay(at, 'Asia/Kolkata')).toBe('2026-11-15')
    expect(toLocalInput(at, 'Asia/Kolkata')).toBe('2026-11-15T00:15')
  })
  it('handles spring gaps, chooses the earlier fold, and advances civil days', () => {
    expect(new Date(localInstant('2026-03-08', '02:30', 'America/New_York')).toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(new Date(localInstant('2026-11-01', '01:30', 'America/New_York')).toISOString()).toBe('2026-11-01T05:30:00.000Z')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
  it('rejects invalid zones and duplicate slots', () => {
    const medication = { name: 'Example', instructions: '', times: ['08:15'], timezone: 'Asia/Kolkata' }
    expect(medicationInput.safeParse(medication).success).toBe(true)
    expect(medicationInput.safeParse({ ...medication, timezone: 'Asia/NotAZone' }).success).toBe(false)
    expect(medicationInput.safeParse({ ...medication, times: ['08:15', '08:15'] }).success).toBe(false)
  })
  it('generates a deterministic handoff using source records', () => {
    const sample = demoData()
    const handoff = demoHandoff(sample)
    expect(handoff.mode).toBe('records')
    expect(handoff.items.map((item) => item.id)).toEqual(['yesterday-missed', 'morning-taken', 'follow-up'])
  })
})
