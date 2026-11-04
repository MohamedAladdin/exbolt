import { describe, expect, it } from 'vitest'
import { buildSuggestions, normalizeQuestion } from './knowledge-suggest'

const customer = (text: string) => ({
  sender_type: 'customer',
  ai_generated: false,
  content_text: text,
})
const human = (text: string) => ({
  sender_type: 'agent',
  ai_generated: false,
  content_text: text,
})
const bot = (text: string) => ({
  sender_type: 'bot',
  ai_generated: true,
  content_text: text,
})

describe('normalizeQuestion', () => {
  it('collapses whitespace and drops trailing question marks', () => {
    expect(normalizeQuestion('  إيه  مواعيد   العيادة ؟ ')).toBe('إيه مواعيد العيادة')
    expect(normalizeQuestion('What are your hours?')).toBe('What are your hours')
  })
})

describe('buildSuggestions', () => {
  it('pairs a customer question with the next human answer', () => {
    const out = buildSuggestions([
      customer('مواعيد العيادة يوم الجمعة إيه؟'),
      human('الجمعة من ١٠ الصبح لـ ٢ الضهر، بنستقبل بالحجز المسبق.'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].question).toBe('مواعيد العيادة يوم الجمعة إيه')
    expect(out[0].answer).toContain('١٠ الصبح')
  })

  it('ignores pairs where the bot answered — the bot never learns from itself', () => {
    const out = buildSuggestions([
      customer('مواعيد العيادة يوم الجمعة إيه؟'),
      bot('الجمعة من ١٠ لـ ٢'),
      human('الجمعة من ١٠ الصبح لـ ٢ الضهر.'),
    ])
    expect(out).toEqual([])
  })

  it('skips short questions and short answers', () => {
    expect(buildSuggestions([customer('تم'), human('تمام يا فندم، تحت أمرك في أي وقت.')])).toEqual(
      [],
    )
    expect(buildSuggestions([customer('عايز أعرف مواعيد العيادة')])).toEqual([])
    expect(
      buildSuggestions([customer('عايز أعرف مواعيد العيادة'), human('تمام')]),
    ).toEqual([])
  })

  it('stops at the next customer message (no answer for that question)', () => {
    const out = buildSuggestions([
      customer('ينفع أحجز بكرة الصبح؟'),
      customer('ولا المواعيد مليانة؟'),
      human('بكرة الصبح متاح من ١١، تحب أحجزلك؟'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].question).toBe('ولا المواعيد مليانة')
  })

  it('deduplicates the same question asked twice', () => {
    const out = buildSuggestions([
      customer('سعر الكشف كام؟'),
      human('الكشف ٦٥٠ جنيه شامل الاستشارة والمتابعة.'),
      customer('سعر الكشف كام'),
      human('الكشف ٦٥٠ جنيه شامل الاستشارة والمتابعة.'),
    ])
    expect(out).toHaveLength(1)
  })
})
