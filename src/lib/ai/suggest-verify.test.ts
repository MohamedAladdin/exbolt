import { describe, expect, it } from 'vitest'
import { parseVerified } from './suggest-verify'

const CANDIDATES = [
  { question: 'الكشف بكام؟', answer: '٦٥٠ جنيه.' },
  { question: 'في فرع في المعادي؟', answer: 'لا، مفيش فرع في المعادي.' },
]

describe('parseVerified', () => {
  it('keeps the reviewer-approved pairs and rewrites them', () => {
    const out = parseVerified(
      JSON.stringify({
        keep: [{ i: 1, question: 'في فرع في المعادي؟', answer: 'لا يوجد فرع في المعادي.' }],
      }),
      CANDIDATES,
    )
    expect(out).toEqual([
      { question: 'في فرع في المعادي؟', answer: 'لا يوجد فرع في المعادي.' },
    ])
  })

  it('drops out-of-range indexes, short text and duplicates', () => {
    const out = parseVerified(
      JSON.stringify({
        keep: [
          { i: 9, question: 'سؤال خارج النطاق؟', answer: 'إجابة طويلة كفاية هنا.' },
          { i: 0, question: 'كام؟', answer: 'إجابة طويلة كفاية هنا.' },
          { i: 0, question: 'الكشف بكام؟', answer: 'الكشف ٦٥٠ جنيه شامل الاستشارة.' },
          { i: 0, question: 'الكشف بكام؟', answer: 'الكشف ٦٥٠ جنيه شامل الاستشارة.' },
        ],
      }),
      CANDIDATES,
    )
    expect(out).toEqual([
      { question: 'الكشف بكام؟', answer: 'الكشف ٦٥٠ جنيه شامل الاستشارة.' },
    ])
  })

  it('treats an empty keep list, prose or junk as "nothing to add"', () => {
    expect(parseVerified('{"keep":[]}', CANDIDATES)).toEqual([])
    expect(parseVerified('I would keep the first one.', CANDIDATES)).toEqual([])
    expect(parseVerified('', CANDIDATES)).toEqual([])
  })
})
