// ============================================================
// /api/ai/cron — what the assistant is allowed to remember and propose.
//
// Guarded by AUTOMATION_CRON_SECRET (`x-cron-secret`), the same convention the
// automations, flows and reports pingers use.
//
// Each tick, per account whose assistant is on:
//   1. FACTS — contacts with activity in the last 7 days whose facts are older
//      than 7 days get one extraction pass: the model is asked for a small,
//      whitelisted JSON object and the rows are upserted into `contact_facts`.
//      No tools, no function calling, no writes outside that table.
//   2. SUGGESTIONS — conversations with human replies produce question/answer
//      pairs (deterministic, no model call) stored as `draft`. An admin must
//      approve one before it becomes knowledge, so the bot can never teach
//      itself unvetted content.
//
// Responses are counters, never prose.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { extractFactsForContact } from '@/lib/ai/facts'
import { suggestFromConversation } from '@/lib/ai/knowledge-suggest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Tokens cost money: bound every tick. */
const FACTS_PER_RUN = 10
const FACTS_REFRESH_DAYS = 7
const SUGGESTIONS_PER_RUN = 20
const TRANSCRIPT_LIMIT = 40
const LOOKBACK_DAYS = 7

interface Counter {
  accounts: number
  facts: number
  suggestions: number
  failed: number
}

export async function POST(request: Request) {
  const secret = process.env.AUTOMATION_CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 })
  }
  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const counters: Counter = { accounts: 0, facts: 0, suggestions: 0, failed: 0 }

  const { data: activeConfigs, error: configErr } = await db
    .from('ai_configs')
    .select('account_id')
    .eq('is_active', true)

  if (configErr) {
    console.error('[ai/cron] config list failed:', configErr.message)
    return NextResponse.json({ error: 'config_lookup_failed' }, { status: 500 })
  }

  let factsBudget = FACTS_PER_RUN
  let suggestionBudget = SUGGESTIONS_PER_RUN

  for (const row of activeConfigs ?? []) {
    const accountId = row.account_id as string
    counters.accounts += 1

    let config
    try {
      config = await loadAiConfig(db, accountId)
    } catch (err) {
      console.warn(`[ai/cron] account ${accountId}: config unusable:`, err)
      counters.failed += 1
      continue
    }
    if (!config) continue

    try {
      const summary = await runAccount(db, accountId, config, factsBudget, suggestionBudget)
      counters.facts += summary.facts
      counters.suggestions += summary.suggestions
      counters.failed += summary.failed
      factsBudget -= summary.facts
      suggestionBudget -= summary.suggestions
    } catch (err) {
      console.error(`[ai/cron] account ${accountId} failed:`, err)
      counters.failed += 1
    }
  }

  return NextResponse.json(counters)
}

async function runAccount(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  config: NonNullable<Awaited<ReturnType<typeof loadAiConfig>>>,
  factsBudget: number,
  suggestionBudget: number,
): Promise<{ facts: number; suggestions: number; failed: number }> {
  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data: conversations, error } = await db
    .from('conversations')
    .select('id, contact_id, last_message_at')
    .eq('account_id', accountId)
    .gte('last_message_at', since)
    .order('last_message_at', { ascending: false })
    .limit(60)

  if (error) {
    console.warn(`[ai/cron] ${accountId}: conversations read failed:`, error.message)
    return { facts: 0, suggestions: 0, failed: 1 }
  }

  const result = { facts: 0, suggestions: 0, failed: 0 }

  // ---------- knowledge suggestions (deterministic, no model) ----------
  let suggestionsLeft = suggestionBudget
  for (const conversation of conversations ?? []) {
    if (suggestionsLeft <= 0) break
    const added = await suggestFromConversation(db, {
      accountId,
      conversationId: conversation.id as string,
    })
    if (added > 0) {
      result.suggestions += added
      suggestionsLeft -= added
    }
  }

  // ---------- contact facts (one bounded model call per contact) ----------
  const contactIds = [
    ...new Set(
      (conversations ?? [])
        .map((c) => c.contact_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ].slice(0, 40)

  if (factsBudget <= 0 || contactIds.length === 0) return result

  const { data: contacts } = await db
    .from('contacts')
    .select('id, ai_facts_extracted_at')
    .eq('account_id', accountId)
    .in('id', contactIds)

  const refreshBefore = Date.now() - FACTS_REFRESH_DAYS * 24 * 60 * 60 * 1000
  const due = (contacts ?? []).filter((contact) => {
    const stamp = contact.ai_facts_extracted_at as string | null
    return !stamp || new Date(stamp).getTime() < refreshBefore
  })

  let factsLeft = factsBudget
  for (const contact of due) {
    if (factsLeft <= 0) break
    const conversation = (conversations ?? []).find(
      (c) => c.contact_id === contact.id,
    )
    if (!conversation) continue

    const { data: messages } = await db
      .from('messages')
      .select('sender_type, content_text')
      .eq('conversation_id', conversation.id as string)
      .eq('content_type', 'text')
      .order('created_at', { ascending: true })
      .limit(TRANSCRIPT_LIMIT)

    const transcript = (messages ?? [])
      .map((m) => ({
        role: m.sender_type === 'customer' ? ('user' as const) : ('assistant' as const),
        content: (m.content_text ?? '').trim(),
      }))
      .filter((m) => m.content.length > 0)

    if (transcript.length === 0) continue

    try {
      const stored = await extractFactsForContact(db, {
        accountId,
        contactId: contact.id as string,
        config,
        transcript,
      })
      if (stored > 0) result.facts += stored
      factsLeft -= 1 // budget is per model call, not per stored fact
    } catch (err) {
      console.warn(`[ai/cron] ${accountId}: fact extraction failed:`, err)
      result.failed += 1
      factsLeft -= 1
    }
  }

  return result
}
