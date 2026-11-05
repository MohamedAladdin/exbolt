import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard for the one-click «ردود الوكيل في الدردشات» switch that sits in the
 * header of the provider card.
 *
 * The point of the control is that it is a PANIC SWITCH: one click, takes
 * effect now, and it can only ever touch the one flag that says "answer
 * customers in conversations". Three invariants keep that true, and none of
 * them is reachable from a node-environment render test, so they are asserted
 * on the source shape:
 *  1. it writes through PATCH with that single field — never the whole form,
 *     which would commit half-edited fields and re-validate credentials;
 *  2. it lives in the provider card's header, where the user pointed;
 *  3. it cannot be clicked while the agent's master switch is off, so a click
 *     can never store a flag every runtime gate ignores.
 */
const source = readFileSync(
  join(process.cwd(), 'src', 'components', 'settings', 'ai-config.tsx'),
  'utf8',
)

const handler = source.slice(
  source.indexOf('const handleQuickReply'),
  source.indexOf('const handleSave'),
)

describe('Agent Setup · quick chat-replies switch', () => {
  it('writes the one flag through PATCH', () => {
    expect(handler).toContain("method: 'PATCH'")
    expect(handler).toContain('JSON.stringify({ auto_reply_enabled: next })')
    // The full-body save is the wrong tool here: it rewrites the prompt,
    // the handoff targets and every other column from whatever is on screen.
    expect(handler).not.toContain('buildBody')
  })

  it('reverts the optimistic flip when the write fails', () => {
    expect(handler).toContain('setAutoReplyEnabled(previous)')
    expect(handler.match(/setAutoReplyEnabled\(previous\)/g)).toHaveLength(2)
  })

  it('drops the cached account status so the inbox stops saying "running"', () => {
    expect(handler).toContain('invalidateAiAccountStatus(accountId ?? undefined)')
  })

  it('renders in the provider card header, next to the title', () => {
    const head = source.slice(
      source.indexOf("{t('providerAndKey')}"),
      source.indexOf('<CardContent className="space-y-4">'),
    )
    expect(head).toContain('<CardAction')
    expect(head).toContain('onCheckedChange={handleQuickReply}')
  })

  it('stacks the header on a phone instead of overflowing the card', () => {
    // Measured at 390px: the grid put the action in an empty first column and
    // pushed the pill 70px outside the card's padding. Flex-col on small
    // screens drops it under the description, inside the card.
    const header = source.slice(
      source.indexOf("<CardHeader className=\"max-sm:flex"),
      source.indexOf("{t('providerAndKey')}"),
    )
    expect(header).toContain('max-sm:flex-col')
  })

  it('is disabled until the master switch is on', () => {
    expect(source).toContain(
      'disabled={disabled || quickReplySaving || !isActive}',
    )
  })

  it('hides itself when no config exists', () => {
    const head = source.slice(
      source.indexOf("{t('providerAndKey')}"),
      source.indexOf('<CardContent className="space-y-4">'),
    )
    expect(head).toContain('{configured && (')
  })
})
