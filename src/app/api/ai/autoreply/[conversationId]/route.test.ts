import { describe, expect, it, vi } from 'vitest'

/**
 * «استئناف AI» must hand the thread back *and* answer the message that is
 * already waiting — otherwise the button looks like a no-op until the customer
 * writes again. It must never double-text after a human's own reply.
 */

const h = vi.hoisted(() => ({
  conv: { id: 'conv-1', contact_id: 'contact-1' } as Record<string, unknown> | null,
  lastMessage: null as { sender_type: string; message_id: string | null } | null,
  update: vi.fn(async () => ({ error: null })),
  dispatch: vi.fn(async () => undefined),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    supabase: {
      from(table: string) {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: h.conv, error: null }) }),
              }),
            }),
            update: () => ({
              eq: () => ({ eq: async () => h.update() }),
            }),
          }
        }
        // messages
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: h.lastMessage, error: null }),
                }),
              }),
            }),
          }),
        }
      },
    },
    accountId: 'acct-1',
    userId: 'user-1',
  }),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
  RATE_LIMITS: { send: {} },
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatch,
}))

// `after()` runs the callback immediately in the test, and is a no-op outside
// a request scope.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (fn: () => unknown) => {
      void fn()
    },
  }
})

import { POST } from './route'

const params = { params: Promise.resolve({ conversationId: 'conv-1' }) }
const request = (body: unknown) =>
  new Request('https://bolt.excal.uk/api/ai/autoreply/conv-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/ai/autoreply/[conversationId] — resume', () => {
  it('answers the waiting customer message right after resuming', async () => {
    h.conv = { id: 'conv-1', contact_id: 'contact-1' }
    h.lastMessage = { sender_type: 'customer', message_id: 'wamid.c1' }
    h.dispatch.mockClear()

    const res = await POST(request({ paused: false }), params)
    expect(res.status).toBe(200)
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        inboundMessageId: 'wamid.c1',
      }),
    )
  })

  it('does not double-text when a human replied last', async () => {
    h.conv = { id: 'conv-1', contact_id: 'contact-1' }
    h.lastMessage = { sender_type: 'agent', message_id: 'wamid.a1' }
    h.dispatch.mockClear()

    await POST(request({ paused: false }), params)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('never fires the bot when pausing', async () => {
    h.conv = { id: 'conv-1', contact_id: 'contact-1' }
    h.lastMessage = { sender_type: 'customer', message_id: 'wamid.c1' }
    h.dispatch.mockClear()

    await POST(request({ paused: true, assign_to_me: true }), params)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
