import { describe, expect, it } from 'vitest';

import {
  FORWARD_TARGET_MAX,
  forwardPayloadFor,
  normalizeForwardTargets,
} from './forward-message';

const MEDIA_URL =
  'https://x.supabase.co/storage/v1/object/public/chat-media/account-a/1770000000000-invoice.pdf';

describe('forwardPayloadFor', () => {
  it('re-sends text as text', () => {
    expect(
      forwardPayloadFor({ content_type: 'text', content_text: ' أهلاً ' })
    ).toEqual({
      payload: {
        messageType: 'text',
        contentText: 'أهلاً',
        mediaUrl: null,
        filename: null,
      },
    });
  });

  it('re-sends media by its durable chat-media URL', () => {
    const plan = forwardPayloadFor({
      content_type: 'document',
      content_text: 'الفاتورة',
      media_url: MEDIA_URL,
    });
    expect(plan.payload).toMatchObject({
      messageType: 'document',
      contentText: 'الفاتورة',
      mediaUrl: MEDIA_URL,
      filename: 'invoice.pdf',
    });
  });

  it('drops the caption for audio — Meta rejects one', () => {
    const plan = forwardPayloadFor({
      content_type: 'audio',
      content_text: 'hello',
      media_url: MEDIA_URL,
    });
    expect(plan.payload?.contentText).toBeNull();
  });

  it('reports media it cannot re-send', () => {
    expect(
      forwardPayloadFor({
        content_type: 'image',
        content_text: 'x',
        media_url: '1234567890',
      })
    ).toEqual({ reason: 'media_unavailable' });
    expect(
      forwardPayloadFor({ content_type: 'image', content_text: 'x', media_url: null })
    ).toEqual({ reason: 'media_unavailable' });
  });

  it('forwards a template as its rendered body', () => {
    expect(
      forwardPayloadFor({
        content_type: 'template',
        content_text: 'موعدك بكرة الساعة ١٠',
        template_name: 'appointment',
      }).payload?.contentText
    ).toBe('موعدك بكرة الساعة ١٠');
  });

  it('refuses a message with nothing to send', () => {
    expect(forwardPayloadFor({ content_type: 'text', content_text: '  ' })).toEqual({
      reason: 'no_content',
    });
    expect(
      forwardPayloadFor({ content_type: 'location', content_text: null })
    ).toEqual({ reason: 'unsupported' });
  });
});

describe('normalizeForwardTargets', () => {
  it('dedupes, drops empties and caps at five', () => {
    expect(normalizeForwardTargets(['a', 'a', null, 'b', undefined])).toEqual([
      'a',
      'b',
    ]);
    const many = Array.from({ length: 9 }, (_, i) => `c${i}`);
    expect(normalizeForwardTargets(many)).toHaveLength(FORWARD_TARGET_MAX);
  });

  it('handles a missing list', () => {
    expect(normalizeForwardTargets(undefined)).toEqual([]);
    expect(normalizeForwardTargets(null)).toEqual([]);
  });
});
