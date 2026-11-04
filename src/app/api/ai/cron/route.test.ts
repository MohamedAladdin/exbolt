import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  configs: [{ account_id: 'acct-1' }] as { account_id: string }[],
  loadAiConfig: vi.fn(),
  suggestFromConversation: vi.fn(),
  extractFactsForContact: vi.fn(),
  conversations: [] as { id: string; contact_id: string | null; last_message_at: string }[],
}))

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const done = (data: unknown) => Promise.resolve({ data, error: null })
      builder.select = () => builder
      builder.eq = () => builder
      builder.in = () => builder
      builder.gte = () => builder
      builder.order = () => builder
      builder.limit = async () =>
        done(
          table === 'ai_configs'
            ? h.configs
            : table === 'conversations'
              ? h.conversations
              : table === 'messages'
                ? []
                : [],
        )
      builder.then = (resolve: (r: { data: unknown; error: null }) => unknown) =>
        resolve({ data: table === 'ai_configs' ? h.configs : [], error: null })
      return builder
    },
  }),
}))

vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/ai/facts', () => ({ extractFactsForContact: h.extractFactsForContact }))
vi.mock('@/lib/ai/knowledge-suggest', () => ({
  suggestFromConversation: h.suggestFromConversation,
}))

import { POST } from './route'

function request(secret?: string) {
  return new Request('https://bolt.excal.uk/api/ai/cron', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  })
}

const CONFIG = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  baseUrl: null,
  apiKey: 'k',
  systemPrompt: null,
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
  scheduleEnabled: false,
  scheduleStart: '09:00',
  scheduleEnd: '21:00',
  scheduleDays: [0, 1, 2, 3, 4],
  scheduleTimezone: 'Africa/Cairo',
  outsideHoursMode: 'always' as const,
  outsideHoursMessage: null,
  embeddingsApiKey: null,
}

describe('/api/ai/cron', () => {
  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 'cron-secret'
    h.configs = [{ account_id: 'acct-1' }]
    h.conversations = []
    h.loadAiConfig.mockResolvedValue(CONFIG)
    h.suggestFromConversation.mockResolvedValue(0)
    h.extractFactsForContact.mockResolvedValue(0)
  })

  afterEach(() => {
    delete process.env.AUTOMATION_CRON_SECRET
  })

  it('refuses a request without the secret', async () => {
    const res = await POST(request())
    expect(res.status).toBe(401)
  })

  it('refuses a request with the wrong secret', async () => {
    const res = await POST(request('nope'))
    expect(res.status).toBe(401)
  })

  it('answers 503 when the secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = await POST(request('anything'))
    expect(res.status).toBe(503)
  })

  it('reports counters, and does nothing for an account with no recent traffic', async () => {
    const res = await POST(request('cron-secret'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ accounts: 1, facts: 0, suggestions: 0, failed: 0 })
  })

  it('counts the suggestions it stores', async () => {
    h.conversations = [
      { id: 'conv-1', contact_id: 'contact-1', last_message_at: new Date().toISOString() },
    ]
    h.suggestFromConversation.mockResolvedValue(2)
    const res = await POST(request('cron-secret'))
    const body = await res.json()
    expect(body.suggestions).toBe(2)
  })

  it('skips an account whose config cannot be loaded, and counts the failure', async () => {
    h.loadAiConfig.mockRejectedValueOnce(new Error('bad key'))
    const res = await POST(request('cron-secret'))
    const body = await res.json()
    expect(body.failed).toBe(1)
    expect(body.facts).toBe(0)
  })
})
