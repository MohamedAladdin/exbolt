import { describe, expect, it } from 'vitest'
import { buildAnthropicSystem, emptyContentDiagnostic } from './anthropic'

describe('buildAnthropicSystem — prompt cache breakpoint', () => {
  const STABLE = 'You are the clinic assistant.\n\nBusiness context:\n- be brief'
  const VARIABLE = 'Knowledge base:\n[1] المنصورة: حي الجامعة'

  it('sends one cacheable block for the stable prefix and one for the rest', () => {
    const prompt = `${STABLE}\n\n${VARIABLE}`
    const system = buildAnthropicSystem(prompt, STABLE.length)
    expect(Array.isArray(system)).toBe(true)
    const blocks = system as {
      type: string
      text: string
      cache_control?: { type: string }
    }[]
    expect(blocks).toHaveLength(2)
    expect(blocks[0].text).toBe(STABLE)
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(blocks[1].text).toBe(VARIABLE)
    // The variable block must NOT carry a breakpoint: it changes every call.
    expect(blocks[1].cache_control).toBeUndefined()
  })

  it('keeps a plain string when there is nothing to cache', () => {
    expect(buildAnthropicSystem(`${STABLE}\n\n${VARIABLE}`, 0)).toBe(
      `${STABLE}\n\n${VARIABLE}`,
    )
    expect(buildAnthropicSystem(`${STABLE}\n\n${VARIABLE}`, undefined)).toBe(
      `${STABLE}\n\n${VARIABLE}`,
    )
    // A boundary past the end caches the whole prompt (nothing variable).
    const whole = buildAnthropicSystem(STABLE, 9999) as {
      cache_control?: { type: string }
    }[]
    expect(whole).toHaveLength(1)
    expect(whole[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('caches the stable block alone when there is no variable part', () => {
    const system = buildAnthropicSystem(STABLE, STABLE.length) as {
      type: string
      text: string
      cache_control?: { type: string }
    }[]
    expect(system).toHaveLength(1)
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' })
  })
})

describe('emptyContentDiagnostic', () => {
  it('names the stop reason and the block types', () => {
    expect(
      emptyContentDiagnostic([{ type: 'thinking' }, { type: 'thinking' }], 'max_tokens'),
    ).toBe('stop_reason=max_tokens blocks=thinking,thinking')
  })

  it('says none when the provider sent no blocks at all', () => {
    expect(emptyContentDiagnostic(undefined, 'end_turn')).toBe(
      'stop_reason=end_turn blocks=none',
    )
    expect(emptyContentDiagnostic([], null)).toBe('stop_reason=unknown blocks=none')
  })
})
