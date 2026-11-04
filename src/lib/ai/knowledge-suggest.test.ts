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

  it('skips past a bot reply to the human correction (the bot is not ground truth)', () => {
    const out = buildSuggestions([
      customer('مواعيد العيادة يوم الجمعة إيه؟'),
      bot('الجمعة من ١٠ لـ ٢'),
      human('الجمعة من ١٠ الصبح لـ ٢ الضهر.'),
    ])
    // The human answer wins; whether it truly answers the question is the
    // reviewer's call, not the heuristic's.
    expect(out).toHaveLength(1)
    expect(out[0].answer).toContain('١٠ الصبح')
  })

  it('keeps nothing when only the bot answered', () => {
    const out = buildSuggestions([
      customer('مواعيد العيادة يوم الجمعة إيه؟'),
      bot('الجمعة من ١٠ لـ ٢'),
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

describe('buildSuggestions — noise filters', () => {
  it('rejects a statement even when a human replied right after it', () => {
    const out = buildSuggestions([
      { sender_type: 'customer', ai_generated: false, content_text: 'نتيجة التحليل ظهرت خلاص' },
      { sender_type: 'agent', ai_generated: false, content_text: 'تمام، ابعتلنا صورة النتيجة هنا.' },
    ])
    expect(out).toEqual([])
  })

  it('rejects a pure-politeness answer', () => {
    const out = buildSuggestions([
      { sender_type: 'customer', ai_generated: false, content_text: 'الكشف بكام يوم السبت؟' },
      { sender_type: 'agent', ai_generated: false, content_text: 'تحت امرك' },
    ])
    expect(out).toEqual([])
  })

  it('rejects a pair whose human answer came hours later', () => {
    const out = buildSuggestions([
      {
        sender_type: 'customer',
        ai_generated: false,
        content_text: 'مواعيد العيادة يوم الجمعة إيه؟',
        created_at: '2026-11-04T09:00:00Z',
      },
      {
        sender_type: 'agent',
        ai_generated: false,
        content_text: 'الجمعة من ١٠ الصبح لـ ٢ الضهر، بنستقبل بالحجز المسبق.',
        created_at: '2026-11-04T14:00:00Z',
      },
    ])
    expect(out).toEqual([])
  })

  it('accepts the same pair when the human answered within the window', () => {
    const out = buildSuggestions([
      {
        sender_type: 'customer',
        ai_generated: false,
        content_text: 'مواعيد العيادة يوم الجمعة إيه؟',
        created_at: '2026-11-04T09:00:00Z',
      },
      {
        sender_type: 'agent',
        ai_generated: false,
        content_text: 'الجمعة من ١٠ الصبح لـ ٢ الضهر، بنستقبل بالحجز المسبق.',
        created_at: '2026-11-04T09:10:00Z',
      },
    ])
    expect(out).toHaveLength(1)
  })
})
