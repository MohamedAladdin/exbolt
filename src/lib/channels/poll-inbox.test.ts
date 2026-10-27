import { describe, expect, it } from 'vitest';

import { graphConversationsToWebhook, type GraphConversation } from './poll-inbox';

const PAGE_ID = '569851976479351';
const CUSTOMER_ID = '2154104814706409';

const convo = (messages: GraphConversation['messages']): GraphConversation => ({
  id: 't_1',
  updated_time: '2026-10-27T11:43:24+0000',
  messages,
});

describe('graphConversationsToWebhook', () => {
  it('shapes an inbound Messenger message into a webhook body', () => {
    const body = graphConversationsToWebhook({
      channel: 'messenger',
      externalId: PAGE_ID,
      conversations: [
        convo({
          data: [
            {
              id: 'm_abc',
              created_time: '2026-10-27T11:43:24+0000',
              from: { id: CUSTOMER_ID, name: 'Customer' },
              message: '  hello  ',
            },
          ],
        }),
      ],
    });

    expect(body?.object).toBe('page');
    const item = body?.entry?.[0]?.messaging?.[0] as {
      sender: { id: string };
      timestamp: number;
      message: { mid: string; text: string; is_echo: boolean };
    };
    expect(body?.entry?.[0]?.id).toBe(PAGE_ID);
    expect(item.sender.id).toBe(CUSTOMER_ID);
    expect(item.message.mid).toBe('m_abc');
    expect(item.message.text).toBe('hello');
    expect(item.message.is_echo).toBe(false);
    expect(item.timestamp).toBe(Date.parse('2026-10-27T11:43:24+0000'));
  });

  it('drops the Page’s own outbound messages so replies are not duplicated', () => {
    const body = graphConversationsToWebhook({
      channel: 'messenger',
      externalId: PAGE_ID,
      conversations: [
        convo({
          data: [
            { id: 'm_out', from: { id: PAGE_ID }, message: 'our reply' },
            { id: 'm_in', from: { id: CUSTOMER_ID }, message: 'customer' },
          ],
        }),
      ],
    });

    const items = body?.entry?.[0]?.messaging ?? [];
    expect(items).toHaveLength(1);
    expect((items[0] as { message: { mid: string } }).message.mid).toBe('m_in');
  });

  it('skips messages with no id (cannot be de-duplicated) or no content', () => {
    const body = graphConversationsToWebhook({
      channel: 'messenger',
      externalId: PAGE_ID,
      conversations: [
        convo({
          data: [
            { from: { id: CUSTOMER_ID }, message: 'no id' },
            { id: 'm_empty', from: { id: CUSTOMER_ID } },
            { id: 'm_ok', from: { id: CUSTOMER_ID }, message: 'kept' },
          ],
        }),
      ],
    });

    const items = body?.entry?.[0]?.messaging ?? [];
    expect(items).toHaveLength(1);
    expect((items[0] as { message: { mid: string } }).message.mid).toBe('m_ok');
  });

  it('maps image and file attachments to Meta attachment types', () => {
    const body = graphConversationsToWebhook({
      channel: 'messenger',
      externalId: PAGE_ID,
      conversations: [
        convo({
          data: [
            {
              id: 'm_img',
              from: { id: CUSTOMER_ID },
              attachments: {
                data: [
                  { image_data: { url: 'https://cdn.example/a.jpg' }, mime_type: 'image/jpeg' },
                  { file_url: 'https://cdn.example/b.pdf', mime_type: 'application/pdf' },
                ],
              },
            },
          ],
        }),
      ],
    });

    const item = body?.entry?.[0]?.messaging?.[0] as {
      message: { attachments: { type: string; payload: { url: string } }[] };
    };
    expect(item.message.attachments).toEqual([
      { type: 'image', payload: { url: 'https://cdn.example/a.jpg' } },
      { type: 'file', payload: { url: 'https://cdn.example/b.pdf' } },
    ]);
  });

  it('returns null when nothing new is worth persisting', () => {
    expect(
      graphConversationsToWebhook({
        channel: 'messenger',
        externalId: PAGE_ID,
        conversations: [convo({ data: [] }), convo(undefined)],
      })
    ).toBeNull();
  });

  it('uses the instagram object for IG channels', () => {
    const body = graphConversationsToWebhook({
      channel: 'instagram',
      externalId: '17841400000000000',
      conversations: [
        convo({ data: [{ id: 'ig_1', from: { id: '999' }, message: 'hi' }] }),
      ],
    });
    expect(body?.object).toBe('instagram');
  });
});
