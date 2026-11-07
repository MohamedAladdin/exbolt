import { afterEach, describe, expect, it } from 'vitest'

import { MAX_OUTPUT_TOKENS, maxOutputTokens } from './defaults'

describe('maxOutputTokens', () => {
  const original = process.env.AI_MAX_OUTPUT_TOKENS

  afterEach(() => {
    if (original === undefined) delete process.env.AI_MAX_OUTPUT_TOKENS
    else process.env.AI_MAX_OUTPUT_TOKENS = original
  })

  it('defaults to a cap that does not truncate a multi-paragraph answer', () => {
    delete process.env.AI_MAX_OUTPUT_TOKENS
    expect(maxOutputTokens()).toBe(MAX_OUTPUT_TOKENS)
    // The old 1024 was the reason a Sonnet reply could be cut mid-sentence.
    expect(MAX_OUTPUT_TOKENS).toBeGreaterThan(1024)
  })

  it('lets a deployment override the cap', () => {
    process.env.AI_MAX_OUTPUT_TOKENS = '2048'
    expect(maxOutputTokens()).toBe(2048)
  })

  it('ignores a junk override instead of sending NaN to the provider', () => {
    process.env.AI_MAX_OUTPUT_TOKENS = 'lots'
    expect(maxOutputTokens()).toBe(MAX_OUTPUT_TOKENS)
  })
})
