import { describe, expect, it } from 'vitest'
import {
  describeWorkWindow,
  isInsideWorkWindow,
  loadAiSchedule,
  parseTimeToMinutes,
  type WorkWindow,
} from './hours'

const CAIRO: WorkWindow = {
  enabled: true,
  start: '09:00:00',
  end: '17:00:00',
  days: [0, 1, 2, 3, 4], // Sun–Thu, the Egyptian working week
  timezone: 'Africa/Cairo',
}

// November 2026: Egypt is on UTC+2 (DST ended late October), so
// 07:00Z = 09:00 in Cairo and 2026-11-04 is a Wednesday.
const wed = (utcHour: number, utcMinute = 0) =>
  new Date(Date.UTC(2026, 10, 4, utcHour, utcMinute))

describe('parseTimeToMinutes', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540)
    expect(parseTimeToMinutes('09:00:00')).toBe(540)
    expect(parseTimeToMinutes('17:30')).toBe(1050)
    expect(parseTimeToMinutes('0:05')).toBe(5)
  })

  it('rejects junk and out-of-range values', () => {
    expect(parseTimeToMinutes('')).toBeNaN()
    expect(parseTimeToMinutes('9')).toBeNaN()
    expect(parseTimeToMinutes('24:00')).toBeNaN()
    expect(parseTimeToMinutes('09:60')).toBeNaN()
  })
})

describe('isInsideWorkWindow', () => {
  it('is open from the start minute (inclusive) to the end minute (exclusive)', () => {
    expect(isInsideWorkWindow(CAIRO, wed(6, 59))).toBe(false) // 08:59 Cairo
    expect(isInsideWorkWindow(CAIRO, wed(7, 0))).toBe(true) // 09:00 Cairo
    expect(isInsideWorkWindow(CAIRO, wed(14, 59))).toBe(true) // 16:59 Cairo
    expect(isInsideWorkWindow(CAIRO, wed(15, 0))).toBe(false) // 17:00 Cairo
  })

  it('closes on a day that is not in the working week', () => {
    // 2026-11-06 is a Friday; 11:00 Cairo.
    const friday = new Date(Date.UTC(2026, 10, 6, 9, 0))
    expect(isInsideWorkWindow(CAIRO, friday)).toBe(false)
  })

  it('handles a window that crosses midnight', () => {
    const overnight: WorkWindow = {
      ...CAIRO,
      start: '22:00',
      end: '02:00',
      days: [0, 1, 2, 3, 4, 5, 6],
    }
    expect(isInsideWorkWindow(overnight, wed(21, 0))).toBe(true) // 23:00 Cairo
    expect(isInsideWorkWindow(overnight, wed(22, 30))).toBe(true) // 00:30 Cairo (next day)
    expect(isInsideWorkWindow(overnight, wed(12, 0))).toBe(false) // 14:00 Cairo
  })

  it('treats a disabled window as always open', () => {
    expect(isInsideWorkWindow({ ...CAIRO, enabled: false }, wed(2, 0))).toBe(
      true,
    )
  })

  it('fails open on a misconfigured window', () => {
    expect(isInsideWorkWindow({ ...CAIRO, days: [] }, wed(2, 0))).toBe(true)
    expect(
      isInsideWorkWindow({ ...CAIRO, start: 'nope', end: 'also-nope' }, wed(2, 0)),
    ).toBe(true)
    expect(
      isInsideWorkWindow({ ...CAIRO, timezone: 'Mars/Olympus' }, wed(2, 0)),
    ).toBe(true)
  })

  it('reads the clock in the account timezone, not the server one', () => {
    // 09:00Z is 11:00 in Cairo (open) but 04:00 in New York (closed).
    const newYork: WorkWindow = { ...CAIRO, timezone: 'America/New_York' }
    expect(isInsideWorkWindow(CAIRO, wed(7, 0))).toBe(true)
    expect(isInsideWorkWindow(newYork, wed(7, 0))).toBe(false)
  })
})

describe('describeWorkWindow', () => {
  it('summarises the window for logs', () => {
    expect(describeWorkWindow(CAIRO)).toBe(
      'Sun,Mon,Tue,Wed,Thu 09:00:00–17:00:00 (Africa/Cairo)',
    )
  })
})

describe('loadAiSchedule', () => {
  function fakeDb(result: { data: Record<string, unknown> | null; error: unknown }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => result }),
        }),
      }),
    } as unknown as Parameters<typeof loadAiSchedule>[0]
  }

  it("reads the assistant's own window from ai_configs", async () => {
    const window = await loadAiSchedule(
      fakeDb({
        data: {
          ai_schedule_enabled: true,
          ai_schedule_start: '10:00:00',
          ai_schedule_end: '22:00:00',
          ai_schedule_days: [0, 5, 6],
          ai_schedule_timezone: 'Africa/Cairo',
        },
        error: null,
      }),
      'acct-1',
    )
    expect(window).toEqual({
      enabled: true,
      start: '10:00:00',
      end: '22:00:00',
      days: [0, 5, 6],
      timezone: 'Africa/Cairo',
    })
  })

  it('falls back to "always available" when the row or the read fails', async () => {
    const missing = await loadAiSchedule(fakeDb({ data: null, error: null }), 'a')
    expect(missing.enabled).toBe(false)
    expect(isInsideWorkWindow(missing, new Date('2026-11-06T09:00:00Z'))).toBe(true)

    const broken = await loadAiSchedule(
      fakeDb({ data: null, error: { message: 'boom' } }),
      'a',
    )
    expect(broken.enabled).toBe(false)
  })

  it('never consults accounts.business_hours_*', async () => {
    const from = (table: string) => {
      expect(table).toBe('ai_configs')
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                ai_schedule_enabled: false,
                ai_schedule_start: '09:00:00',
                ai_schedule_end: '21:00:00',
                ai_schedule_days: [0, 1, 2, 3, 4],
                ai_schedule_timezone: 'Africa/Cairo',
              },
              error: null,
            }),
          }),
        }),
      }
    }
    await loadAiSchedule(
      { from } as unknown as Parameters<typeof loadAiSchedule>[0],
      'acct-1',
    )
  })
})
