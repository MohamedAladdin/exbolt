import { describe, expect, it } from 'vitest'
import { formatFacts, loadContactFacts, parseExtractedFacts } from './facts'

describe('parseExtractedFacts', () => {
  it('keeps whitelisted keys with sane values', () => {
    const facts = parseExtractedFacts(
      JSON.stringify({
        facts: [
          { key: 'preferred_branch', value: 'الشيخ زايد', confidence: 0.92 },
          { key: 'patient_name', value: 'أحمد', confidence: 1 },
        ],
      }),
    )
    expect(facts).toEqual([
      { fact_key: 'preferred_branch', fact_value: 'الشيخ زايد', confidence: 0.92 },
      { fact_key: 'patient_name', fact_value: 'أحمد', confidence: 1 },
    ])
  })

  it('tolerates code fences and chatter around the object', () => {
    const raw = 'Sure! ```json\n{"facts":[{"key":"city","value":"الجيزة"}]}\n```'
    expect(parseExtractedFacts(raw)).toEqual([
      { fact_key: 'city', fact_value: 'الجيزة', confidence: 0.8 },
    ])
  })

  it('drops invented keys, empty values, duplicates and junk', () => {
    const facts = parseExtractedFacts(
      JSON.stringify({
        facts: [
          { key: 'favourite_colour', value: 'blue' }, // not whitelisted
          { key: 'city', value: ' ' }, // empty
          { key: 'city', value: 'القاهرة' },
          { key: 'city', value: 'الجيزة' }, // duplicate key
          'not-an-object',
          { key: 'patient_name', value: 'x'.repeat(300) }, // too long
        ],
      }),
    )
    expect(facts).toEqual([
      { fact_key: 'city', fact_value: 'القاهرة', confidence: 0.8 },
    ])
  })

  it('caps the number of facts', () => {
    const many = {
      facts: [
        { key: 'patient_name', value: 'أحمد' },
        { key: 'preferred_branch', value: 'زايد' },
        { key: 'preferred_doctor', value: 'د. سارة' },
        { key: 'insurance', value: 'مصر للتأمين' },
        { key: 'file_number', value: 'A-12' },
        { key: 'alt_phone', value: '01000000000' },
        { key: 'preferred_time', value: 'بعد العصر' },
        { key: 'city', value: 'الجيزة' },
      ],
    }
    // 8 allowed keys → still one row each; the cap bites on extra duplicates.
    expect(parseExtractedFacts(JSON.stringify(many))).toHaveLength(8)
  })

  it('returns [] for anything that is not the expected JSON', () => {
    expect(parseExtractedFacts('')).toEqual([])
    expect(parseExtractedFacts('I could not find any facts.')).toEqual([])
    expect(parseExtractedFacts('{"facts":"nope"}')).toEqual([])
    expect(parseExtractedFacts('{not json}')).toEqual([])
  })
})

describe('formatFacts', () => {
  it('renders one line per fact and nothing for an empty list', () => {
    expect(formatFacts([])).toBe('')
    expect(
      formatFacts([
        { fact_key: 'city', fact_value: 'الجيزة' },
        { fact_key: 'patient_name', fact_value: 'أحمد' },
      ]),
    ).toBe('- city: الجيزة\n- patient_name: أحمد')
  })
})

describe('loadContactFacts', () => {
  const db = (result: { data: unknown; error: unknown }) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ order: async () => result }),
          }),
        }),
      }),
    }) as unknown as Parameters<typeof loadContactFacts>[0]

  it('returns the rows for the contact', async () => {
    const rows = await loadContactFacts(
      db({ data: [{ fact_key: 'city', fact_value: 'الجيزة' }], error: null }),
      'acct-1',
      'contact-1',
    )
    expect(rows).toEqual([{ fact_key: 'city', fact_value: 'الجيزة' }])
  })

  it('degrades to no memory when the read fails or there is no contact', async () => {
    expect(
      await loadContactFacts(db({ data: null, error: { message: 'boom' } }), 'a', 'c'),
    ).toEqual([])
    expect(await loadContactFacts(db({ data: [], error: null }), 'a', null)).toEqual([])
  })
})
