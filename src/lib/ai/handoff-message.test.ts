import { describe, expect, it } from 'vitest'
import { handoffMessagePayload } from './handoff-message'

/**
 * The wipe this guards: a Save on Settings → Agent → Setup used to post
 * `handoff_message: null` whenever the box happened to render empty, and the
 * route takes a provided string as truth — so the tenant's saved transfer note
 * disappeared even though the field had never been touched.
 */
describe('handoffMessagePayload', () => {
  it('sends nothing at all when the box was never edited', () => {
    // undefined is dropped by JSON.stringify → the API sees no key → the
    // stored note survives, which is the whole fix.
    expect(handoffMessagePayload('', false)).toBeUndefined()
    expect(handoffMessagePayload('نص قديم لم يلمسه أحد', false)).toBeUndefined()
  })

  it('clears the note only when a hand emptied the box', () => {
    expect(handoffMessagePayload('', true)).toBeNull()
    expect(handoffMessagePayload('   ', true)).toBeNull()
  })

  it('writes the typed note, trimmed', () => {
    expect(handoffMessagePayload('  بحوّلك حالًا لواحد من الفريق.  ', true)).toBe(
      'بحوّلك حالًا لواحد من الفريق.',
    )
  })
})
