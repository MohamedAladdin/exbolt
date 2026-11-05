import { describe, expect, it } from 'vitest'
import { deepLinkTarget } from './deep-link'

/**
 * Guard for the «اللينك مافتحش المحادثة» report (2026-11-05): the inbox only
 * holds one page of conversations, and the deep-link resolver used to look for
 * the id in that page alone. A thread at rank 27 of 1551 — i.e. any thread
 * that received no message in the last 25 — opened to an empty center panel.
 */
describe('deepLinkTarget', () => {
  it('selects a row that is already in the loaded page', () => {
    expect(deepLinkTarget('conv-a', ['conv-a', 'conv-b'])).toBe('loaded')
  })

  it('fetches from the database when the row sits past the loaded page', () => {
    const page = Array.from({ length: 25 }, (_, i) => `conv-${i}`)
    expect(deepLinkTarget('conv-27', page)).toBe('database')
  })

  it('fetches from the database when the current filters hide every row', () => {
    expect(deepLinkTarget('conv-27', [])).toBe('database')
  })
})
