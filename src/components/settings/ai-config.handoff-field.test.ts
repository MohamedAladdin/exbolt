import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard for the transfer-note wipe reported by a client on 2026-11-05:
 * «خانة رسالة التحويل محفوظة على السيرفر، لكن صفحة الـ Setup ساعات بتفتحها
 * فاضية. لو حد عمل Save من الصفحة وهي فاضية، الرسالة هتتمسح.»
 *
 * Two invariants make that impossible, and neither is reachable from a
 * node-environment test, so they are asserted on the source shape:
 *  1. the box is hydrated from the stored row on every load;
 *  2. the column is written only through the edited-gated payload — an
 *     untouched box sends no key at all, so the API leaves the note alone.
 */
const source = readFileSync(
  join(process.cwd(), 'src', 'components', 'settings', 'ai-config.tsx'),
  'utf8',
)

describe('Agent Setup · transfer note field', () => {
  it('hydrates the box from the stored value', () => {
    expect(source).toContain('setHandoffMessage(data.handoff_message ?? ')
  })

  it('writes the column only through the edited-gated payload', () => {
    expect(source).toContain('handoffMessagePayload(handoffMessage, handoffEdited)')
    // The old unconditional shape is the regression itself.
    expect(source).not.toContain('handoff_message: handoffMessage.trim()')
  })

  it('marks the field as edited only from the textarea', () => {
    const field = source.slice(source.indexOf('id="ai-handoff-msg"'))
    expect(field.slice(0, 400)).toContain('setHandoffEdited(true)')
  })
})
