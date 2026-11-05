/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'

// The reported bug, as a regression test: the assistant's reply went out signed
// with the personal name of the account owner, because the send path resolved
// the signature's `{{ agent_name }}` through the human who owns the API key.
// A bot must sign with its own name (ai_configs.agent_name, migration 106) and
// fall back to the business — never to a person who did not write the words.

const h = vi.hoisted(() => ({
  sent: [] as string[],
  account: { signature_enabled: true, signature_template: '{{ agent_name }}', name: 'عيادة هيموكيور' },
  agentName: 'مساعد هيموكيور' as string | null,
  profile: { full_name: '3amer', email: 'owner@clinic.test' },
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: async ({ text }: { text: string }) => {
    h.sent.push(text)
    return { messageId: 'wamid.1' }
  },
  sendMediaMessage: async () => ({ messageId: 'wamid.media' }),
  sendInteractiveButtons: async () => ({ messageId: 'wamid.btn' }),
  sendInteractiveList: async () => ({ messageId: 'wamid.list' }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))

vi.mock('@/lib/whatsapp/config-resolver', () => ({
  loadConversationMetaCredentials: async () => ({
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
  }),
  resolveWhatsAppConfigForConversation: async () => ({
    id: 'cfg-1',
    phone_number_id: 'pn-1',
    access_token: 'tok',
  }),
  getDefaultWhatsAppConfig: async () => ({ id: 'cfg-1' }),
}))

vi.mock('@/lib/whatsapp/conversation-scope', () => ({
  assertConversationInAccount: async () => {},
}))

const inserted: Array<Record<string, unknown>> = []

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        update: () => builder,
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row)
          return { error: null }
        },
        maybeSingle: async () => {
          if (table === 'contacts') {
            return { data: { id: 'ct-1', phone: '201000000000', wa_user_id: null }, error: null }
          }
          if (table === 'accounts') return { data: h.account, error: null }
          if (table === 'profiles') return { data: h.profile, error: null }
          if (table === 'ai_configs') {
            return { data: { agent_name: h.agentName }, error: null }
          }
          return { data: null, error: null }
        },
        single: async () => ({ data: null, error: null }),
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({ data: null, error: null }),
      }
      return builder
    },
  }),
}))

import { engineSendText } from './meta-send'

async function send(aiGenerated: boolean) {
  h.sent.length = 0
  inserted.length = 0
  await engineSendText({
    accountId: 'acct-1',
    userId: 'user-owner',
    conversationId: 'cv-1',
    contactId: 'ct-1',
    text: 'الموعد بكرة الساعة ٦',
    aiGenerated,
  })
  return { sent: h.sent[0], persisted: inserted[0]?.content_text }
}

describe('flows engineSendText — signature identity', () => {
  it('signs an AI reply with the assistant name, never the account owner', async () => {
    h.agentName = 'مساعد هيموكيور'
    const { sent, persisted } = await send(true)

    expect(sent).toBe('الموعد بكرة الساعة ٦\n\nمساعد هيموكيور')
    // Meta and the inbox must show the same string.
    expect(persisted).toBe(sent)
    expect(sent).not.toContain('3amer')
  })

  it('sends the reply unsigned when the assistant has no name', async () => {
    // Not "fall back to the account name": that name is usually a person's,
    // and the whole report was a bot signing with «3amer». No name for the
    // bot means no signature on its words.
    h.agentName = null
    const { sent, persisted } = await send(true)

    expect(sent).toBe('الموعد بكرة الساعة ٦')
    expect(persisted).toBe('الموعد بكرة الساعة ٦')
    expect(sent).not.toContain('3amer')
    expect(sent).not.toContain('عيادة هيموكيور')
  })

  it('still signs the assistant with the business when the template asks for it', async () => {
    // A template that never mentions {{ agent_name }} is unaffected: the
    // business name is the business's own, not a borrowed one.
    h.agentName = null
    h.account = { ...h.account, signature_template: '{{ business_name }}' }
    const { sent } = await send(true)
    h.account = { ...h.account, signature_template: '{{ agent_name }}' }

    expect(sent).toBe('الموعد بكرة الساعة ٦\n\nعيادة هيموكيور')
  })

  it('signs a flow prompt with the business — nobody typed it', async () => {
    h.agentName = 'مساعد هيموكيور'
    const { sent } = await send(false)

    expect(sent).toBe('الموعد بكرة الساعة ٦\n\nعيادة هيموكيور')
  })

  it('sends the body untouched while the signature is off', async () => {
    h.agentName = 'مساعد هيموكيور'
    h.account = { ...h.account, signature_enabled: false }
    const { sent, persisted } = await send(true)
    h.account = { ...h.account, signature_enabled: true }

    expect(sent).toBe('الموعد بكرة الساعة ٦')
    expect(persisted).toBe('الموعد بكرة الساعة ٦')
  })
})
