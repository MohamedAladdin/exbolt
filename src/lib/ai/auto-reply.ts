import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledgeParts } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPromptParts } from './defaults'
import { buildHandoffSummary } from './handoff'
import { notifyHandoff } from './handoff-alert'
import {
  describeWorkWindow,
  isInsideWorkWindow,
  loadAiSchedule,
} from './hours'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { aiPauseState } from './pause'
import { AiError } from './types'
import {
  engineSendText,
  loadConversationMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { toChannel, type Channel } from '@/lib/channels/types'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

const tAi = getT('AiAgent')

/** At most one "we're closed" reply per thread in this window. */
const AWAY_REPLY_COOLDOWN_MS = 6 * 60 * 60 * 1000

/**
 * How long a handoff mutes the assistant before it resumes on its own.
 *
 * A handoff used to disable auto-reply on the thread *permanently*: if no
 * agent picked the thread up — the common case when the account has no
 * handoff target configured — every later message from that customer was
 * ignored. Ten minutes is long enough for a human to take over and
 * short enough that a missed handoff does not cost the conversation.
 */
const HANDOFF_PAUSE_MS = 10 * 60 * 1000

/**
 * Acknowledgements and punctuation that need no answer.
 *
 * The model used to answer these with the handoff sentinel, and a handoff
 * permanently disables auto-reply on the thread — so «شكرًا» or «..» quietly
 * switched the assistant off for that customer and rang the team's bell. These
 * messages get silence, and the thread stays enabled.
 */
// NB: greetings are NOT in this list. In this business a first message is
// usually «السلام عليكم» or «مساء الخير», and staying silent on it reads as a
// dead assistant — the model answers those with a greeting + intro. Only
// acknowledgements (nothing to act on) and content-free messages are skipped.
const TRIVIAL_INBOUND =
  /^(?:[.،,?؟!\s\-]+|شكرا(?:ً|ا)?|شكرًا|متشكر(?:ة|ه)?|تسلم(?:ي|وا)?|تمام|اوك|أوك|اوكيه|ok(?:ay)?|thanks|thank you|thx|جزاك(?:م|ي)? الله(?: خيرا| خيرًا)?|ربنا يخليك(?:م|وا)?|يعطيك العافية)[\s.،,!؟🙏👍🌹❤️🤍💙😊😍]*$/iu

/**
 * Does this inbound need a reply at all?
 *
 * Conservative on purpose: only clearly content-free messages (punctuation,
 * emoji, a bare acknowledgement) count. Anything with substance goes to the
 * model, which may still hand off — that is what handoff is for.
 */
export function isTrivialInbound(text: string | null | undefined): boolean {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!value) return true
  if (TRIVIAL_INBOUND.test(value)) return true
  // Strip emoji/punctuation: fewer than 4 real characters is not a request.
  const stripped = value.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{P}\p{S}\s]/gu, '')
  return stripped.length < 4
}

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
  } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'channel, assigned_agent_id, ai_autoreply_disabled, ai_paused_until, ai_reply_count, outside_hours_notified_at',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    const channel = toChannel(conv.channel)
    // `ai_autoreply_disabled` covers two different intents: a handoff (which
    // carries a deadline in `ai_paused_until`) and a human switching the bot
    // off on the thread (no deadline, never auto-resumes).
    const pause = aiPauseState(conv.ai_autoreply_disabled, conv.ai_paused_until)
    if (pause === 'paused') return
    if (pause === 'expired') {
      // The handoff window ended with nobody assigned: take the thread back
      // instead of leaving the customer unanswered for good.
      await db
        .from('conversations')
        .update({ ai_autoreply_disabled: false, ai_paused_until: null })
        .eq('id', conversationId)
      console.log(
        `[ai auto-reply] resuming on ${conversationId} — handoff window elapsed with no owner.`,
      )
    }
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    // The assistant's OWN window (Agents → Setup → schedule), deliberately
    // separate from the team's business hours that feed the response-time
    // metric. Outside it the account chooses whether the bot stays silent or
    // posts one canned reply; `always` — the default — falls through to a
    // normal answer, so nothing changes for accounts that never open the
    // screen.
    const schedule = await loadAiSchedule(db, accountId)
    if (schedule.enabled && !isInsideWorkWindow(schedule)) {
      if (config.outsideHoursMode === 'silent') {
        console.log(
          `[ai auto-reply] outside the AI schedule (${describeWorkWindow(schedule)}) — silent mode, no reply.`,
        )
        return
      }
      if (config.outsideHoursMode === 'message') {
        await sendOutsideHoursReply({
          db,
          accountId,
          configOwnerUserId,
          conversationId,
          contactId,
          channel,
          text: config.outsideHoursMessage?.trim() || tAi('awayMessage'),
          lastNotifiedAt: conv.outside_hours_notified_at,
        })
        return
      }
    }

    const messages = await buildConversationContext(
      db,
      conversationId,
      config.contextMessageLimit,
    )
    if (messages.length === 0) return

    // «شكرًا» / «..» get silence — not a handoff, which would mute the thread
    // for this customer for good.
    if (isTrivialInbound(latestUserMessage(messages))) {
      console.log(
        `[ai auto-reply] trivial inbound on ${conversationId} — no reply, thread stays enabled.`,
      )
      return
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Every gate has passed — we're committed to attempting a reply, so
    // show the customer "typing…" (and mark their message read) while the
    // retrieval + LLM round trips run. Meta clears the indicator after
    // 25 s or when our reply lands, whichever is first, so there's
    // nothing to undo on the handoff / no-text path. Strictly
    // best-effort: a failed indicator must never cost us the reply.
    // Messenger/Instagram have no typing indicator on the Send API.
    if (inboundMessageId && channel === 'whatsapp') {
      await showTypingIndicator(db, accountId, conversationId, inboundMessageId)
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledgeParts = await retrieveKnowledgeParts(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    // Customer memory is OFF until it earns its place: the client's own tests
    // showed the injected facts could colour an answer about a different
    // branch. The prompt goes back to exactly what it was before it existed;
    // the table and the extractor stay for when we turn it on deliberately.
    const prompt = buildSystemPromptParts({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge: knowledgeParts.retrieved,
      pinnedKnowledge: knowledgeParts.pinned,
    })
    const systemPrompt = [prompt.stable, prompt.variable]
      .filter(Boolean)
      .join('\n\n')

    const generateArgs = {
      config,
      systemPrompt,
      // Everything before the retrieved excerpts is identical on every call —
      // providers with explicit prompt caching (Anthropic) get a breakpoint
      // there, so the instructions stop being billed at full price each turn.
      stablePrefixLength: prompt.stable.length,
      messages,
    }

    // A provider that answers with no text (Anthropic does this under load:
    // "returned an empty response") used to end the turn with nothing said.
    // One retry is cheap next to a customer left hanging; only after it fails
    // do we treat the turn as unanswerable.
    let generated
    try {
      generated = await generateReply(generateArgs)
    } catch (err) {
      if (!isRetryableAiError(err)) throw err
      console.warn(
        '[ai auto-reply] provider returned no usable text — retrying once:',
        err instanceof Error ? err.message : err,
      )
      generated = await generateReply(generateArgs)
    }
    const { text, handoff, usage } = generated

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: true,
          // Bounded: if no agent takes the thread, the next inbound after
          // this instant resumes the assistant (see `aiPauseState`).
          ai_paused_until: new Date(Date.now() + HANDOFF_PAUSE_MS).toISOString(),
          ai_handoff_summary: summary,
        })
        .eq('id', conversationId)
      // One owner (the first target) so the inbox says who has it; the whole
      // list is alerted. Assigning fires the `on_conversation_assigned`
      // trigger, so the assignee must not be notified twice.
      const targets = config.handoffAgentIds
      const owner = targets[0] ?? null
      if (owner) {
        await db
          .from('conversations')
          .update({ assigned_agent_id: owner })
          .eq('id', conversationId)
          .is('assigned_agent_id', null)
      }
      // Empty list → the whole team (nobody owns it and nobody was told; the
      // note lives inside the thread, so this is the only thing that reaches
      // a human).
      await notifyHandoff(db, {
        accountId,
        conversationId,
        contactId,
        summary,
        targets: owner ? targets.slice(1) : [],
        fallbackToTeam: !owner,
      })
      // From the customer's side, a handoff that sends nothing is the same as
      // being ignored — worst on the exact message that usually triggers it
      // (a complaint). If the account configured a holding line, send it now:
      // the thread is already muted, so this cannot double-reply.
      if (config.handoffMessage) {
        try {
          await sendAssistantText({
            db,
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            channel,
            text: config.handoffMessage,
          })
        } catch (err) {
          console.error('[ai auto-reply] handoff message failed:', err)
        }
      }
      return
    }

    if (
      inboundMessageId &&
      (await hasNewerInbound(db, conversationId, inboundMessageId))
    ) {
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return

    await sendAssistantText({
      db,
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      channel,
      text,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * One outbound path for the assistant, whatever the thread's channel.
 *
 * WhatsApp goes through the flow runner's sender (signature, phone
 * variants, its own 24h-window handling). Messenger/Instagram threads go
 * through the channel-aware sender the inbox uses, with `aiGenerated` so
 * the persisted row is attributed to the assistant and not to the config
 * owner — the same rule as `signOutgoingText`'s `{ kind: 'ai' }`.
 */
async function sendAssistantText(args: {
  db: ReturnType<typeof supabaseAdmin>
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  channel: Channel
  text: string
}): Promise<void> {
  if (args.channel === 'whatsapp') {
    await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: args.text,
      aiGenerated: true,
    })
    return
  }

  await sendMessageToConversation(
    args.db,
    args.accountId,
    {
      conversationId: args.conversationId,
      messageType: 'text',
      contentText: args.text,
      senderId: args.userId,
    },
    { aiGenerated: true },
  )
}

/**
 * Worth one more provider call: a rate limit, a provider-side 5xx (which is
 * how Anthropic's empty content block surfaces) or a timeout. A 400-class
 * error is a configuration problem and retrying it only doubles the wait.
 */
function isRetryableAiError(err: unknown): boolean {
  if (!(err instanceof AiError)) return false
  const message = err.message.toLowerCase()
  return (
    err.status === 429 ||
    err.status >= 500 ||
    message.includes('empty response') ||
    message.includes('overloaded') ||
    message.includes('timed out')
  )
}

async function hasNewerInbound(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  inboundMessageId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return false
  return data[0].message_id !== inboundMessageId
}

/**
 * Outside the working window: one canned reply per thread per cooldown.
 *
 * Runs before any LLM call, so a clinic closed at 2 a.m. spends nothing on
 * the owner's key and the customer still gets an honest answer instead of
 * silence. The cooldown lives on `conversations.outside_hours_notified_at`
 * so a burst of messages doesn't earn a burst of identical replies.
 *
 * Never throws: a failed away-message must not fail the webhook.
 */
async function sendOutsideHoursReply(args: {
  db: ReturnType<typeof supabaseAdmin>
  accountId: string
  configOwnerUserId: string
  conversationId: string
  contactId: string
  channel: Channel
  text: string
  lastNotifiedAt: string | null | undefined
}): Promise<void> {
  const last = args.lastNotifiedAt
    ? new Date(args.lastNotifiedAt).getTime()
    : Number.NaN
  if (
    Number.isFinite(last) &&
    Date.now() - last < AWAY_REPLY_COOLDOWN_MS
  ) {
    return
  }

  try {
    await sendAssistantText({
      db: args.db,
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      channel: args.channel,
      text: args.text,
    })
    await args.db
      .from('conversations')
      .update({ outside_hours_notified_at: new Date().toISOString() })
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
  } catch (err) {
    console.warn('[ai auto-reply] outside-hours reply failed:', err)
  }
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  conversationId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    // Same number the reply will leave from — the indicator is scoped to
    // the thread's own phone number, not the account default.
    const { phoneNumberId, accessToken } = await loadConversationMetaCredentials(
      db,
      accountId,
      conversationId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}
