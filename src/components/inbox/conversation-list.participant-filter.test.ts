import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * His report (2026-11-05): a member profile links to
 * `/inbox?participant=<userId>&days=30`, and the inbox showed that as a "1" on
 * the funnel badge only — opening the popover listed channel / number / company
 * and «مسح كل الفلاتر», with no answer to «أنا داخل محادثات مين» and no way to
 * switch member. So the funnel owns a member selector, and the list carries one
 * muted line naming whose replies are on screen.
 */
const source = readFileSync(
  join(process.cwd(), 'src', 'components', 'inbox', 'conversation-list.tsx'),
  'utf8',
)

describe('Inbox participant filter', () => {
  it('puts a member selector inside the funnel popover', () => {
    const popoverClose = source.indexOf('</PopoverContent>')
    const selector = source.indexOf('participantFilterLabel')
    expect(selector).toBeGreaterThan(-1)
    expect(selector).toBeLessThan(popoverClose)
    expect(source).toContain('onSelectParticipant?.(')
  })

  it('offers the reply windows the member profile can be read through', () => {
    expect(source).toContain('const PARTICIPANT_WINDOWS = [7, 30, 90]')
    expect(source).toContain('participant.days === d')
  })

  it('names the member on one muted line while the view is on', () => {
    expect(source).toContain('t("participantActive"')
    expect(source).toContain('t("participantClear")')
    // No box: it is an explainer line, not a fourth row of chrome.
    const banner = source.slice(source.indexOf('t("participantActive"') - 400)
    expect(banner).toContain('text-[11px] text-muted-foreground')
  })

  it('clears the member view from «مسح كل الفلاتر» too', () => {
    expect(source).toContain('onSelectParticipant?.(null);')
  })
})

describe('Inbox participant copy', () => {
  const keys = [
    'participantFilterLabel',
    'allMembers',
    'participantWindowLabel',
    'participantActive',
    'participantClear',
  ]

  for (const locale of ['ar', 'en'] as const) {
    it(`${locale} defines every participant key`, () => {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8'),
      )
      const list = messages.Inbox.conversationList
      for (const key of keys) expect(list[key], key).toBeTruthy()
      expect(list.participantActive).toContain('{name}')
      expect(list.participantActive).toContain('{days}')
    })
  }
})
