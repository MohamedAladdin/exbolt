import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The alert a handoff raises when it has no human target.
 *
 * The handoff itself already (a) stops the bot on the thread and (b) leaves
 * an internal note — but both live *inside* the conversation, so unless
 * somebody happens to open the inbox nobody learns that a customer is
 * waiting. This writes one notification per teammate who can act on it
 * (owner / admin / agent); the bell + realtime subscription the product
 * already has carries it to them.
 *
 * Never throws: a failed alert must not undo a handoff that already
 * happened.
 */
export const HANDOFF_ALERT_TYPE = 'ai_handoff_unassigned'

/** Roles that are expected to pick a queued conversation up. */
const NOTIFY_ROLES = ['owner', 'admin', 'agent'] as const

export const HANDOFF_ALERT_TITLE = 'The assistant needs a human'

export interface HandoffAlertArgs {
  accountId: string
  conversationId: string
  contactId: string | null
  /** Internal note already written to the conversation. */
  summary: string
}

/**
 * Notify the account's team that a conversation is waiting, unassigned.
 *
 * Idempotent per conversation: a thread that hands off twice (re-enabled,
 * then bailed again) must not ring the bell twice.
 *
 * Returns how many notifications were written (0 when there was nothing to
 * do — no other members, or the alert already exists).
 */
export async function notifyUnassignedHandoff(
  db: SupabaseClient,
  args: HandoffAlertArgs,
): Promise<number> {
  const { accountId, conversationId, contactId, summary } = args

  try {
    const { data: existing, error: existingErr } = await db
      .from('notifications')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('type', HANDOFF_ALERT_TYPE)
      .limit(1)

    if (existingErr) {
      console.warn(
        '[handoff alert] could not check for an existing alert:',
        existingErr.message,
      )
      return 0
    }
    if (existing && existing.length > 0) return 0

    const { data: members, error: membersErr } = await db
      .from('profiles')
      .select('user_id, account_role')
      .eq('account_id', accountId)
      .in('account_role', NOTIFY_ROLES as unknown as string[])

    if (membersErr) {
      console.warn('[handoff alert] could not list the team:', membersErr.message)
      return 0
    }

    const recipients = (members ?? [])
      .map((row) => row.user_id as string | null)
      .filter((id): id is string => Boolean(id))
    if (recipients.length === 0) return 0

    const rows = recipients.map((userId) => ({
      account_id: accountId,
      user_id: userId,
      type: HANDOFF_ALERT_TYPE,
      conversation_id: conversationId,
      contact_id: contactId,
      actor_user_id: null,
      title: HANDOFF_ALERT_TITLE,
      body: `${summary} Pick it up in the inbox.`,
    }))

    const { error: insertErr } = await db.from('notifications').insert(rows)
    if (insertErr) {
      console.warn('[handoff alert] insert failed:', insertErr.message)
      return 0
    }
    return rows.length
  } catch (err) {
    console.warn('[handoff alert] unexpected failure:', err)
    return 0
  }
}
