import { describe, it, expect } from 'vitest'

import { aiPauseState } from './pause'

describe('aiPauseState', () => {
  const now = Date.parse('2026-11-07T09:00:00.000Z')

  it('lets the assistant reply on an enabled thread', () => {
    expect(aiPauseState(false, null, now)).toBe('active')
    expect(aiPauseState(null, null, now)).toBe('active')
  })

  it('keeps a human pause permanent (no deadline)', () => {
    expect(aiPauseState(true, null, now)).toBe('paused')
    expect(aiPauseState(true, undefined, now)).toBe('paused')
  })

  it('stays paused while the handoff window is open', () => {
    expect(aiPauseState(true, '2026-11-07T09:29:59.000Z', now)).toBe('paused')
  })

  it('expires a handoff window so the next inbound resumes the assistant', () => {
    expect(aiPauseState(true, '2026-11-07T09:00:00.000Z', now)).toBe('expired')
    expect(aiPauseState(true, '2026-11-06T09:00:00.000Z', now)).toBe('expired')
  })

  it('treats an unparseable deadline as a human pause, never a resume', () => {
    expect(aiPauseState(true, 'not-a-date', now)).toBe('paused')
  })
})
