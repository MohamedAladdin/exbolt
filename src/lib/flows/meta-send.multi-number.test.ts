/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'

// Regression guard for the multi-number reply bug (Meta 131047):
// every engine send must leave from the number the customer wrote to.
// The account default is only a fallback for legacy threads, because
// Meta tracks the 24h service window per business number.

const h = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  convConfigId: 'cfg-second' as string | null,
}))

const DEFAULT_ROW = {
  id: 'cfg-default',
  account_id: 'acct-1',
  phone_number_id: 'pn-default',
  waba_id: 'waba-1',
  access_token: 'tok-default',
  is_default: true,
  created_at: '2026-10-01T00:00:00Z',
}

const SECOND_ROW = {
  id: 'cfg-second',
  account_id: 'acct-1',
  phone_number_id: 'pn-second',
  waba_id: 'waba-1',
  access_token: 'tok-second',
  is_default: false,
  created_at: '2026-10-20T00:00:00Z',
}

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `dec:${v}`,
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        update: () => builder,
        insert: async () => ({ error: null }),
        maybeSingle: async () => {
          if (table === 'contacts') {
            return {
              data: { id: 'ct-1', phone: '201018174741', wa_user_id: null },
              error: null,
            }
          }
          if (table === 'conversations') {
            return {
              data: { id: 'cv-second', whatsapp_config_id: h.convConfigId },
              error: null,
            }
          }
          return { data: null, error: null }
        },
        // Two numbers on the account → PostgREST answers PGRST116 on the
        // single read, so the resolver falls through to the list read.
        single: async () =>
          table === 'whatsapp_config'
            ? { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
            : { data: null, error: null },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({
            data: table === 'whatsapp_config' ? [DEFAULT_ROW, SECOND_ROW] : null,
            error: null,
          }),
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: async (args: Record<string, unknown>) => {
    h.sent.push(args)
    return { messageId: 'wamid.text' }
  },
  sendMediaMessage: async (args: Record<string, unknown>) => {
    h.sent.push(args)
    return { messageId: 'wamid.media' }
  },
  sendInteractiveButtons: async (args: Record<string, unknown>) => {
    h.sent.push(args)
    return { messageId: 'wamid.buttons' }
  },
  sendInteractiveList: async (args: Record<string, unknown>) => {
    h.sent.push(args)
    return { messageId: 'wamid.list' }
  },
}))

import { engineSendText } from './meta-send'

const ARGS = {
  accountId: 'acct-1',
  userId: 'u-1',
  conversationId: 'cv-second',
  contactId: 'ct-1',
  text: 'أهلاً بك',
  aiGenerated: true,
}

describe("engineSendText — sends from the thread's own number", () => {
  it('uses the conversation number, not the account default', async () => {
    h.convConfigId = 'cfg-second'
    h.sent = []
    await engineSendText(ARGS)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].phoneNumberId).toBe('pn-second')
    expect(h.sent[0].accessToken).toBe('dec:tok-second')
    expect(h.sent[0].to).toBe('201018174741')
  })

  it('falls back to the default number for a legacy thread', async () => {
    h.convConfigId = null
    h.sent = []
    await engineSendText(ARGS)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].phoneNumberId).toBe('pn-default')
    expect(h.sent[0].accessToken).toBe('dec:tok-default')
  })
})
