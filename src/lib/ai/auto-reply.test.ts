import { describe, it, expect, vi, beforeEach } from 'vitest'
import { __resetRateLimitForTests } from '@/lib/rate-limit'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  /** Media rows for the current inbound batch; empty = text-only thread. */
  media: [] as {
    content_type: string | null
    media_url: string | null
    content_text: string | null
  }[],
  /** What the media layer "reads" from this batch. */
  readMediaForModel: vi.fn(),
  audioTranscriptionTarget: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  loadConversationMetaCredentials: vi.fn(),
  sendTypingIndicator: vi.fn(),
  loadAiSchedule: vi.fn(),
  isInsideWorkWindow: vi.fn(),
  notifyHandoff: vi.fn(),
  loadContactFacts: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    updates: [] as { payload: Record<string, unknown>; isNull: string[] }[],
    rpcCalls: [] as { name: string; args: unknown }[],
    latestInbound: [] as { message_id: string }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({
  buildConversationContext: h.buildConversationContext,
  // The dispatcher reads the media rows of the current batch through the turn
  // builder; tests set `h.media` and share the transcript mock above.
  buildConversationTurn: async (...args: unknown[]) => ({
    messages: (await h.buildConversationContext(...args)) ?? [],
    media: h.media,
  }),
}))
vi.mock('./knowledge', () => ({
  // The dispatcher now asks for the pinned/variable split; keep the test
  // surface as a flat list by returning everything as `retrieved`.
  retrieveKnowledgeParts: async (...args: unknown[]) => ({
    pinned: [],
    retrieved: await h.retrieveKnowledge(...args),
  }),
}))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./media', async (importOriginal) => {
  // Keep the pure shapers real (they are what puts a transcript on the turn)
  // and stub only the two calls that would hit the network.
  const actual = await importOriginal<typeof import('./media')>()
  return {
    ...actual,
    readMediaForModel: h.readMediaForModel,
    audioTranscriptionTarget: h.audioTranscriptionTarget,
  }
})
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  loadConversationMetaCredentials: h.loadConversationMetaCredentials,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTypingIndicator: h.sendTypingIndicator,
}))
vi.mock('./hours', () => ({
  loadAiSchedule: h.loadAiSchedule,
  isInsideWorkWindow: h.isInsideWorkWindow,
  describeWorkWindow: () => 'Sun-Thu 09:00-21:00 (Africa/Cairo)',
}))
vi.mock('./handoff-alert', () => ({
  notifyHandoff: h.notifyHandoff,
}))
vi.mock('./facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./facts')>()
  return { ...actual, loadContactFacts: h.loadContactFacts }
})
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'messages') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.latestInbound, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = { ...h.state.updatePayload, ...payload }
          const record = { payload, isNull: [] as string[] }
          h.state.updates.push(record)
          const result = Promise.resolve({ error: null })
          const filter = Object.assign(result, {
            is: (column: string) => {
              record.isNull.push(column)
              return result
            },
          })
          return { eq: () => filter }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  inboundMessageId: 'wamid.inbound-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    baseUrl: null,
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    contextMessageLimit: 20,
    handoffAgentIds: [],
    scheduleEnabled: false,
    scheduleStart: '09:00',
    scheduleEnd: '21:00',
    scheduleDays: [0, 1, 2, 3, 4],
    scheduleTimezone: 'Africa/Cairo',
    outsideHoursMode: 'always',
    outsideHoursMessage: null,
    embeddingsApiKey: null,
    handoffMessage: null,
    ...overrides,
  }
}

beforeEach(() => {
  // The dispatcher's per-account throttle is a module-level fixed window: a
  // long file would otherwise spend acct-1's 30-request budget as it grows and
  // fail the LAST tests with «hit the per-account rate limit».
  __resetRateLimitForTests()
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.updates = []
  h.state.rpcCalls = []
  h.state.latestInbound = [{ message_id: 'wamid.inbound-1' }]
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([
    { role: 'user', content: 'عايز أحجز موعد بكرة الصبح' },
  ])
  h.media = []
  h.readMediaForModel.mockResolvedValue({ images: [], transcripts: [], skipped: [] })
  h.audioTranscriptionTarget.mockReturnValue(null)
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.loadConversationMetaCredentials.mockResolvedValue({
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
  })
  h.sendTypingIndicator.mockResolvedValue(undefined)
  h.loadAiSchedule.mockResolvedValue({
    enabled: false,
    start: '09:00',
    end: '17:00',
    days: [0, 1, 2, 3, 4],
    timezone: 'UTC',
  })
  h.isInsideWorkWindow.mockReturnValue(true)
  h.notifyHandoff.mockResolvedValue(2)
  h.loadContactFacts.mockResolvedValue([])
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the slot claim is refused after a human takeover', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('leaves the reply to the newer run when another inbound arrived', async () => {
    h.state.latestInbound = [{ message_id: 'wamid.inbound-2' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('replies when the triggering inbound is still the latest', async () => {
    h.state.latestInbound = [{ message_id: 'wamid.inbound-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })
})


describe('dispatchInboundToAiReply — handoff holding message', () => {
  it('sends the configured line, then mutes the thread', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ handoffMessage: 'آسف على ده، بحوّلك حالًا لواحد من الفريق.' }),
    )
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toBe(
      'آسف على ده، بحوّلك حالًا لواحد من الفريق.',
    )
    // The mock records {payload, isNull} wrappers, not the raw row.
    expect(
      h.state.updates.some(
        (u: { payload?: { ai_autoreply_disabled?: boolean } }) =>
          u.payload?.ai_autoreply_disabled === true,
      ),
    ).toBe(true)
  })

  it('stays silent when no line is configured', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('mutes the thread even when the holding line fails to send', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffMessage: 'لحظة واحدة.' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    h.engineSendText.mockRejectedValue(new Error('131047'))
    await dispatchInboundToAiReply(ARGS)
    // The mock records {payload, isNull} wrappers, not the raw row.
    expect(
      h.state.updates.some(
        (u: { payload?: { ai_autoreply_disabled?: boolean } }) =>
          u.payload?.ai_autoreply_disabled === true,
      ),
    ).toBe(true)
  })
})

describe('dispatchInboundToAiReply — handoff marker with no words', () => {
  it('retries once with a write-a-sentence instruction and sends that text', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffMessage: 'لحظة واحدة.' }))
    h.generateReply
      .mockResolvedValueOnce({ text: '', handoff: true })
      .mockResolvedValueOnce({ text: 'هحوّلك لواحد من الفريق حالًا.', handoff: true })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(2)
    const retrySystemPrompt = h.generateReply.mock.calls[1][0].systemPrompt as string
    expect(retrySystemPrompt).toContain('Never send the marker alone')
    // The retry wrote words for THIS customer, so those words are what goes
    // out — not the generic configured line.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toBe('هحوّلك لواحد من الفريق حالًا.')
    expect(
      h.state.updates.some(
        (u: { payload?: { ai_autoreply_disabled?: boolean } }) =>
          u.payload?.ai_autoreply_disabled === true,
      ),
    ).toBe(true)
  })

  it('sends the retry text even when no holding line is configured', async () => {
    h.generateReply
      .mockResolvedValueOnce({ text: '', handoff: true })
      .mockResolvedValueOnce({ text: 'وصلني طلبك، بدور عليه وأرد عليك.', handoff: true })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toBe('وصلني طلبك، بدور عليه وأرد عليك.')
  })

  it('falls back to the configured line when the retry is empty too', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffMessage: 'استلمنا، الفريق هيرد.' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toBe('استلمنا، الفريق هيرد.')
  })

  it('does not retry an answer that already carries words', async () => {
    h.generateReply.mockResolvedValue({ text: 'تحت أمرك، بحوّلك.', handoff: true })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchInboundToAiReply — typing indicator (#527)', () => {
  it('shows "typing…" on the inbound wamid before calling the LLM', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadConversationMetaCredentials).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'conv-1',
    )
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
    expect(h.sendTypingIndicator).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      messageId: 'wamid.inbound-1',
    })
    // Ordering: the indicator goes out while the customer waits on the
    // model, not after the reply is already generated.
    const typingOrder = h.sendTypingIndicator.mock.invocationCallOrder[0]
    const llmOrder = h.generateReply.mock.invocationCallOrder[0]
    expect(typingOrder).toBeLessThan(llmOrder)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('still sends the reply when the indicator request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.sendTypingIndicator.mockRejectedValue(new Error('Meta API error: 400'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('typing indicator failed'),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it('still sends the reply when the WhatsApp credentials cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.loadConversationMetaCredentials.mockRejectedValue(
      new Error('WhatsApp not configured for this account'),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('skips the indicator when no inbound wamid is supplied', async () => {
    const { inboundMessageId: _omit, ...legacyArgs } = ARGS
    void _omit
    await dispatchInboundToAiReply(legacyArgs)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.loadConversationMetaCredentials).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('does not fire when a gate short-circuits before the LLM', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
    expect(h.loadConversationMetaCredentials).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentIds: ['agent-7'] }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('assigns the handoff agent only while the thread is still unassigned', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentIds: ['agent-7'] }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    const pause = h.state.updates.find((u) => 'ai_autoreply_disabled' in u.payload)
    const assign = h.state.updates.find((u) => 'assigned_agent_id' in u.payload)
    expect(pause?.payload).not.toHaveProperty('assigned_agent_id')
    expect(pause?.isNull).toEqual([])
    expect(assign?.payload).toEqual({ assigned_agent_id: 'agent-7' })
    expect(assign?.isNull).toEqual(['assigned_agent_id'])
  })
})

describe('dispatchInboundToAiReply — outside working hours', () => {
  const closed = {
    enabled: true,
    start: '09:00',
    end: '17:00',
    days: [0, 1, 2, 3, 4],
    timezone: 'Africa/Cairo',
  }

  beforeEach(() => {
    h.loadAiSchedule.mockResolvedValue(closed)
    h.isInsideWorkWindow.mockReturnValue(false)
  })

  it('stays silent in "silent" mode — no model call, no reply, no slot', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ outsideHoursMode: 'silent' }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('sends one away message in "message" mode and records the throttle', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ outsideHoursMode: 'message', outsideHoursMessage: 'closed now' }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        text: 'closed now',
        aiGenerated: true,
      }),
    )
    expect(h.state.updatePayload).toMatchObject({
      outside_hours_notified_at: expect.any(String),
    })
  })

  it('respects the 6h cooldown on the away message', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      outside_hours_notified_at: new Date().toISOString(),
    }
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ outsideHoursMode: 'message', outsideHoursMessage: 'closed now' }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('answers normally when the policy is "always"', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ outsideHoursMode: 'always' }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })
})

describe('dispatchInboundToAiReply — handoff alerts', () => {
  it('alerts the team when the handoff lands in the shared queue', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.notifyHandoff).toHaveBeenCalledTimes(1)
    expect(h.notifyHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
      }),
    )
  })

  it('assigns the first target and does not alert the team', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentIds: ['user-9'] }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ assigned_agent_id: 'user-9' })
    // Only the remaining targets are notified; with a single target the list
    // is empty and the team-wide fallback is off.
    expect(h.notifyHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targets: [], fallbackToTeam: false }),
    )
  })

  it('assigns the first target and alerts the rest of the list', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ handoffAgentIds: ['user-9', 'user-10', 'user-11'] }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ assigned_agent_id: 'user-9' })
    expect(h.notifyHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targets: ['user-10', 'user-11'],
        fallbackToTeam: false,
      }),
    )
  })

})

describe('dispatchInboundToAiReply — customer memory', () => {
  it('is OFF: facts in the table do not reach the prompt today', async () => {
    h.loadContactFacts.mockResolvedValue([
      { fact_key: 'preferred_branch', fact_value: 'الشيخ زايد' },
    ])
    await dispatchInboundToAiReply(ARGS)
    // The extractor and the table exist, but nothing calls them from the reply
    // path until the feature is enabled on purpose.
    expect(h.loadContactFacts).not.toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('already told you in earlier conversations')
    expect(systemPrompt).not.toContain('الشيخ زايد')
  })
})

describe('dispatchInboundToAiReply — trivial inbound', () => {
  it.each([['شكرا'], ['..'], ['🙏'], ['تمام'], ['.'], ['thanks']])(
    'stays quiet on %s without handing off',
    async (text) => {
      h.buildConversationContext.mockResolvedValue([{ role: 'user', content: text }])
      await dispatchInboundToAiReply(ARGS)
      expect(h.generateReply).not.toHaveBeenCalled()
      expect(h.engineSendText).not.toHaveBeenCalled()
      expect(h.state.updatePayload?.ai_autoreply_disabled).toBeUndefined()
      expect(h.notifyHandoff).not.toHaveBeenCalled()
    },
  )

  it.each([['السلام عليكم'], ['مساء الخير'], ['صباح الخير']])(
    'answers the greeting %s instead of going silent',
    async (text) => {
      h.buildConversationContext.mockResolvedValue([{ role: 'user', content: text }])
      await dispatchInboundToAiReply(ARGS)
      expect(h.generateReply).toHaveBeenCalledTimes(1)
    },
  )

  it('still answers a real question that follows a thank-you', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'شكرا' },
      { role: 'assistant', content: 'العفو 🌸' },
      { role: 'user', content: 'طيب مواعيد فرع المهندسين إيه؟' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchInboundToAiReply — context window', () => {
  it('sends only the configured number of recent messages', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ contextMessageLimit: 8 }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.buildConversationContext).toHaveBeenCalledWith(
      expect.anything(),
      'conv-1',
      8,
    )
  })
})

describe('dispatchInboundToAiReply — inbound media', () => {
  const IMAGE_ROW = {
    content_type: 'image',
    media_url: 'https://cdn.test/photo.jpg',
    content_text: null,
  }

  it('answers a photo-only message with the image attached', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }))
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '[image]' }])
    h.media = [IMAGE_ROW]
    h.readMediaForModel.mockResolvedValue({
      images: [{ mediaType: 'image/jpeg', dataBase64: 'AQID' }],
      transcripts: [],
      skipped: [],
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(1)
    const sent = h.generateReply.mock.calls[0][0].messages
    const lastUser = sent[sent.length - 1]
    expect(lastUser.role).toBe('user')
    expect(lastUser.images).toEqual([{ mediaType: 'image/jpeg', dataBase64: 'AQID' }])
    expect(h.sendTypingIndicator).toHaveBeenCalled()
  })

  it('puts a voice-note transcript on the customer turn', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ provider: 'openai', model: 'gpt-4o' }))
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '[voice message]' }])
    h.media = [
      { content_type: 'audio', media_url: 'https://cdn.test/v.ogg', content_text: null },
    ]
    h.readMediaForModel.mockResolvedValue({
      images: [],
      transcripts: ['عايز أحجز موعد بكرة الصبح'],
      skipped: [],
    })

    await dispatchInboundToAiReply(ARGS)

    const sent = h.generateReply.mock.calls[0][0].messages
    expect(sent[sent.length - 1].content).toContain(
      '[voice message transcription] عايز أحجز موعد بكرة الصبح',
    )
  })

  it('hands a document to a human instead of going silent', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ handoffMessage: 'استلمنا ملف حضرتك، الفريق هيراجعه.' }),
    )
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '[document]' }])
    h.media = [
      { content_type: 'document', media_url: 'https://cdn.test/report.pdf', content_text: null },
    ]
    h.readMediaForModel.mockResolvedValue({
      images: [],
      transcripts: [],
      skipped: [{ type: 'document', reason: 'unsupported_type' }],
    })

    await dispatchInboundToAiReply(ARGS)

    // No model call: it cannot see the file, so it must not guess.
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.notifyHandoff).toHaveBeenCalledTimes(1)
    const summary = h.notifyHandoff.mock.calls[0][1].summary as string
    expect(summary).toContain('Customer sent a document')
    // The customer still gets a word — a silent handoff reads as ignored.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toBe(
      'استلمنا ملف حضرتك، الفريق هيراجعه.',
    )
    expect(
      h.state.updates.some(
        (u: { payload?: { ai_autoreply_disabled?: boolean } }) =>
          u.payload?.ai_autoreply_disabled === true,
      ),
    ).toBe(true)
  })

  it('sends ONE holding line per batch — a superseded unreadable attachment stays quiet', async () => {
    // Three attachments in one burst = three dispatches in parallel. The
    // holding line is a reply like any other, so only the batch's newest
    // inbound may send it; the rest bow out before the handoff.
    h.state.latestInbound = [{ message_id: 'wamid.inbound-3' }]
    h.media = [
      { content_type: 'document', media_url: 'https://cdn.test/report.pdf', content_text: null },
    ]
    h.readMediaForModel.mockResolvedValue({
      images: [],
      transcripts: [],
      skipped: [{ type: 'document', reason: 'unsupported_type' }],
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.notifyHandoff).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(
      h.state.updates.some(
        (u: { payload?: { ai_autoreply_disabled?: boolean } }) =>
          u.payload?.ai_autoreply_disabled === true,
      ),
    ).toBe(false)
  })

  it('hands a voice note off when the account has no speech key', async () => {
    // Anthropic-only account: nowhere to transcribe, so silence is not an option.
    h.loadAiConfig.mockResolvedValue(aiConfig({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }))
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '[voice message]' }])
    h.media = [
      { content_type: 'audio', media_url: 'https://cdn.test/v.ogg', content_text: null },
    ]
    h.readMediaForModel.mockResolvedValue({
      images: [],
      transcripts: [],
      skipped: [{ type: 'audio', reason: 'no_audio_key' }],
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    const summary = h.notifyHandoff.mock.calls[0][1].summary as string
    expect(summary).toContain('a voice note')
    expect(summary).toContain('no speech-to-text key')
  })

  it('still answers normally when the caption carries the question', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ provider: 'openai', model: 'gpt-4o' }))
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'التحليل ده كويس؟' },
    ])
    h.media = [{ ...IMAGE_ROW, content_text: 'التحليل ده كويس؟' }]
    h.readMediaForModel.mockResolvedValue({
      images: [{ mediaType: 'image/jpeg', dataBase64: 'AQID' }],
      transcripts: [],
      skipped: [],
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(1)
    // Retrieval runs on the caption, not on the "[image]" marker.
    expect(h.retrieveKnowledge.mock.calls[0].at(-1)).toBe('التحليل ده كويس؟')
  })
})
