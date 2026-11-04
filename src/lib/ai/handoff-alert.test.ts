import { describe, expect, it, vi } from 'vitest'
import { HANDOFF_ALERT_TYPE, notifyHandoff } from './handoff-alert'

/** Minimal Supabase double: records inserts, answers the existence probe. */
function fakeDb(opts: {
  existingAlerts?: { id: string }[]
  members?: { user_id: string | null; account_role: string }[]
  membersError?: { message: string } | null
  insertError?: { message: string } | null
}) {
  const inserted: Record<string, unknown>[][] = []
  const db = {
    from(table: string) {
      if (table === 'notifications') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.limit = async () => ({
          data: opts.existingAlerts ?? [],
          error: null,
        })
        chain.insert = async (rows: Record<string, unknown>[]) => {
          inserted.push(rows)
          return { error: opts.insertError ?? null }
        }
        return chain
      }
      // profiles
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.in = async () => ({
        data: opts.members ?? [],
        error: opts.membersError ?? null,
      })
      return chain
    },
  }
  return { db, inserted }
}

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  summary: '🤖 AI agent handed off after 2 replies.',
  fallbackToTeam: true,
}

const TARGETED = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  summary: '🤖 AI agent handed off after 2 replies.',
  targets: ['u-owner', 'u-agent'],
}

describe('notifyUnassignedHandoff', () => {
  it('notifies every owner/admin/agent of the account once', async () => {
    const { db, inserted } = fakeDb({
      members: [
        { user_id: 'u-owner', account_role: 'owner' },
        { user_id: 'u-agent', account_role: 'agent' },
        { user_id: 'u-viewer', account_role: 'viewer' }, // filtered out in SQL
        { user_id: null, account_role: 'agent' },
      ],
    })
    // The SQL filter runs server-side, so a stray viewer row is still
    // dropped by the null check only; assert on what we send.
    const count = await notifyHandoff(
      db as unknown as Parameters<typeof notifyHandoff>[0],
      ARGS,
    )
    expect(count).toBe(3)
    expect(inserted).toHaveLength(1)
    const rows = inserted[0]
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.type === HANDOFF_ALERT_TYPE)).toBe(true)
    expect(rows.every((r) => r.account_id === 'acct-1')).toBe(true)
    expect(rows.every((r) => r.conversation_id === 'conv-1')).toBe(true)
    expect(String(rows[0].body)).toContain('Pick it up in the inbox')
  })

  it('does not ring the bell twice for the same conversation', async () => {
    const { db, inserted } = fakeDb({
      existingAlerts: [{ id: 'n1' }],
      members: [{ user_id: 'u-owner', account_role: 'owner' }],
    })
    const count = await notifyHandoff(
      db as unknown as Parameters<typeof notifyHandoff>[0],
      ARGS,
    )
    expect(count).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  it('never throws when the team list or the insert fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = fakeDb({ membersError: { message: 'boom' } })
    const count = await notifyHandoff(
      failing.db as unknown as Parameters<typeof notifyHandoff>[0],
      ARGS,
    )
    expect(count).toBe(0)

    const insertFails = fakeDb({
      members: [{ user_id: 'u-owner', account_role: 'owner' }],
      insertError: { message: 'nope' },
    })
    const second = await notifyHandoff(
      insertFails.db as unknown as Parameters<typeof notifyHandoff>[0],
      ARGS,
    )
    expect(second).toBe(0)
    warn.mockRestore()
  })

  it('does nothing for an account with no members', async () => {
    const { db, inserted } = fakeDb({ members: [] })
    const count = await notifyHandoff(
      db as unknown as Parameters<typeof notifyHandoff>[0],
      ARGS,
    )
    expect(count).toBe(0)
    expect(inserted).toHaveLength(0)
  })
})
