import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext, buildConversationTurn } from './context'

/** Minimal fake matching the query chain in buildConversationTurn:
 *  from().select().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const text = (sender: string, content: string) => ({
  sender_type: sender,
  content_type: 'text',
  content_text: content,
  media_url: null,
})

const media = (
  sender: string,
  type: string,
  url: string,
  caption: string | null = null,
) => ({
  sender_type: sender,
  content_type: type,
  content_text: caption,
  media_url: url,
})

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('keeps a media turn as a placeholder instead of dropping it', async () => {
    // The fix: a photo the customer sent used to vanish from the transcript,
    // so the model answered a question it could not see.
    const out = await buildConversationContext(
      fakeDb([
        // Newest first, like the DB returns them.
        text('customer', 'إيه رأيك؟'),
        media('customer', 'document', 'https://cdn.test/r.pdf'),
        media('customer', 'audio', 'https://cdn.test/v.ogg'),
        media('customer', 'image', 'https://cdn.test/p.jpg'),
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: '[image]' },
      { role: 'user', content: '[voice message]' },
      { role: 'user', content: '[document]' },
      { role: 'user', content: 'إيه رأيك؟' },
    ])
  })

  it('prefers the caption when the media row has one', async () => {
    const out = await buildConversationContext(
      fakeDb([media('customer', 'image', 'https://cdn.test/p.jpg', 'نتيجة التحليل')]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'نتيجة التحليل' }])
  })
})

describe('buildConversationTurn — media for the current batch only', () => {
  it('returns the media that arrived after the last assistant turn', async () => {
    const rows = [
      // Newest first, like the DB returns them.
      media('customer', 'image', 'https://cdn.test/new.jpg'),
      media('customer', 'audio', 'https://cdn.test/new.ogg'),
      text('bot', 'شوفت الصورة، محتاج توضيح'),
      media('customer', 'image', 'https://cdn.test/old.jpg'),
    ]
    const turn = await buildConversationTurn(fakeDb(rows), 'conv-1')
    expect(turn.messages).toHaveLength(4)
    expect(turn.media).toEqual([
      {
        content_type: 'audio',
        media_url: 'https://cdn.test/new.ogg',
        content_text: null,
      },
      {
        content_type: 'image',
        media_url: 'https://cdn.test/new.jpg',
        content_text: null,
      },
    ])
  })

  it('returns everything when the assistant has not spoken yet', async () => {
    const rows = [
      // Newest first, like the DB returns them.
      media('customer', 'image', 'https://cdn.test/b.jpg'),
      text('customer', 'دي صورتين'),
      media('customer', 'image', 'https://cdn.test/a.jpg'),
    ]
    const turn = await buildConversationTurn(fakeDb(rows), 'conv-1')
    expect(turn.media.map((m) => m.media_url)).toEqual([
      'https://cdn.test/a.jpg',
      'https://cdn.test/b.jpg',
    ])
  })

  it('keeps a media row with no stored URL so it can be handed off', async () => {
    // Meta's media verify can fail; silence is not an acceptable answer, so
    // the row is reported and `readMediaForModel` marks it download_failed.
    const turn = await buildConversationTurn(
      fakeDb([media('customer', 'image', '')]),
      'conv-1',
    )
    expect(turn.messages).toEqual([{ role: 'user', content: '[image]' }])
    expect(turn.media).toHaveLength(1)
    expect(turn.media[0]!.media_url).toBe('')
  })
})

describe('buildConversationTurn — which rows count as media', () => {
  it('does not treat an interactive tap or a location pin as unreadable media', async () => {
    // A tap or a pin is already text in the transcript; putting it in `media`
    // would send the thread down the handoff path on every button press.
    const turn = await buildConversationTurn(
      fakeDb([
        media('customer', 'interactive', '', 'Yes, interested'),
        media('customer', 'location', '', null),
      ]),
      'conv-1',
    )
    expect(turn.messages).toEqual([
      { role: 'user', content: '[location]' },
      { role: 'user', content: 'Yes, interested' },
    ])
    expect(turn.media).toEqual([])
  })
})
