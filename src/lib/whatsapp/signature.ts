// ============================================================
// Outgoing-message signature.
//
// One template per account, appended to the text body of every message the
// business writes itself (the inbox composer, the AI agent's replies, flows
// and automations). It is OFF by default and the default template is the
// sender's own name — so an account that never opens Settings → Inbox sends
// byte-identical messages to what it sent before this shipped.
//
// The rules live here, in one file, because three send paths have to agree:
//   * `sendMessageToConversation` — dashboard, edit, forward, public v1 API,
//   * `engineSendText` (flows)   — AI agent replies, flow prompts,
//   * `engineSendText` (automations) — automation send_message nodes.
//
// What is deliberately NOT signed:
//   * Meta templates — their body was approved by Meta; editing it would make
//     what the customer sees differ from what Meta reviewed,
//   * interactive button/list payloads — structured content, not prose,
//   * media captions — a caption is capped at 1024 chars and a signature
//     eating that budget silently truncates the business's own words.
//
// Failure direction: every lookup here swallows its error and returns the
// unsigned text. A settings read must never be able to stop a reply from
// going out.
//
// WHO SIGNS (`SignatureSender`): a teammate signs with their own name, the
// assistant signs with `ai_configs.agent_name` (its own field — never the
// human whose key it borrows), and a flow/automation signs with the account
// name. When a name is missing the account name is used, so a signature never
// ends up attributing the bot's words to a person who never wrote them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/** What Settings → Inbox shows before an admin types anything. */
export const DEFAULT_SIGNATURE_TEMPLATE = '{{ agent_name }}'

/** Kept in step with `accounts_signature_template_length` (migration 105). */
export const MAX_SIGNATURE_TEMPLATE_LENGTH = 300

/** Meta's hard cap for `text.body`. */
export const MAX_TEXT_LENGTH = 4096

export const SIGNATURE_AGENT_NAME = '{{ agent_name }}'
export const SIGNATURE_BUSINESS_NAME = '{{ business_name }}'

export interface SignatureContext {
  /** The teammate who pressed send; null for engine / API sends with no user. */
  agentName?: string | null
  businessName?: string | null
}

export interface AccountSignature {
  enabled: boolean
  template: string
  businessName: string | null
}

/**
 * Fill the placeholders and tidy the result.
 *
 * A placeholder that resolves to nothing (`{{ agent_name }}` on a send with
 * no known teammate and no account name) leaves an empty line behind — those
 * lines are dropped, and so are the blank lines around them. A template that
 * resolves to nothing at all renders as '' and the message goes out unsigned
 * rather than with a dangling separator.
 */
export function renderSignature(
  template: string | null | undefined,
  ctx: SignatureContext,
  options: { fallbackAgentName?: boolean } = {},
): string {
  const raw = (template ?? '').slice(0, MAX_SIGNATURE_TEMPLATE_LENGTH)
  const businessName = (ctx.businessName ?? '').trim()
  // A signature that ends with nothing is worse than no signature: over the
  // public API there is no teammate, so the account name is what "who is
  // this" means there.
  //
  // The assistant opts OUT of that fallback: its replies carry its own name or
  // no signature at all, because the account name is very often a person's
  // name — signing a bot's words with it is the bug this option exists for.
  const agentName = options.fallbackAgentName === false
    ? (ctx.agentName ?? '').trim()
    : (ctx.agentName ?? '').trim() || businessName

  return raw
    .replace(/\{\{\s*agent_name\s*\}\}/gi, agentName)
    .replace(/\{\{\s*business_name\s*\}\}/gi, businessName)
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n')
    .trim()
}

/**
 * Append `signature` to `body` with one blank line between them.
 *
 * Idempotent: text that already ends with the signature is returned as-is.
 * That matters for the "edit a failed send" path, where the composer hands
 * back the body it rendered earlier — already signed — and for a retry that
 * re-enters the same send with the text it built the first time.
 *
 * When the result would break Meta's limit the message goes out unsigned
 * instead of truncated: losing a signature is cosmetic, losing the tail of a
 * customer reply is not.
 */
export function appendSignature(
  body: string,
  signature: string,
  maxLength: number = MAX_TEXT_LENGTH,
): string {
  if (!signature) return body
  const trimmedBody = body.replace(/\s+$/, '')
  if (!trimmedBody) return body
  if (trimmedBody.endsWith(signature)) return body
  const combined = `${trimmedBody}\n\n${signature}`
  if (combined.length > maxLength) return body
  return combined
}

/**
 * Read the account's signature settings.
 *
 * A missing column (an older database) or an RLS surprise answers "off": the
 * send path then behaves exactly as it did before the feature existed, which
 * is the only safe default for something that rewrites message bodies.
 */
export async function loadAccountSignature(
  db: SupabaseClient,
  accountId: string,
): Promise<AccountSignature> {
  const { data, error } = await db
    .from('accounts')
    .select('signature_enabled, signature_template, name')
    .eq('id', accountId)
    .maybeSingle()

  if (error || !data) {
    return {
      enabled: false,
      template: DEFAULT_SIGNATURE_TEMPLATE,
      businessName: null,
    }
  }

  const row = data as {
    signature_enabled?: boolean | null
    signature_template?: string | null
    name?: string | null
  }

  return {
    enabled: row.signature_enabled === true,
    template: row.signature_template ?? DEFAULT_SIGNATURE_TEMPLATE,
    businessName: (row.name ?? '').trim() || null,
  }
}

/**
 * The sender's display name: their profile name, then the local part of
 * their email, then null. Never throws — a rename is not worth a failed
 * send.
 */
export async function resolveSenderName(
  db: SupabaseClient,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null
  const { data, error } = await db
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as { full_name?: string | null; email?: string | null }
  const fullName = (row.full_name ?? '').trim()
  if (fullName) return fullName
  const local = (row.email ?? '').split('@')[0]?.trim()
  return local || null
}

/** Message types whose body is prose we control and may sign. */
export const SIGNABLE_MESSAGE_TYPES = new Set(['text'])

/**
 * Who is speaking — the one thing the signature has to get right.
 *
 * `member`  a teammate typed it: their profile name.
 * `ai`      the assistant answered: `ai_configs.agent_name` (106). It must
 *           never fall back to the human who owns the key — a clinic's bot
 *           signing with the doctor's personal name is the bug this was
 *           added for.
 * `system`  a flow or an automation: nobody is speaking, so the business is.
 *
 * Every kind falls back to the account name when its own name is missing.
 */
export type SignatureSender =
  | { kind: 'member'; userId?: string | null }
  | { kind: 'ai' }
  | { kind: 'system' }

/**
 * The assistant's own display name (migration 106). Null when unset — the
 * caller then signs with the account name rather than inventing one.
 */
export async function resolveAiAgentName(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('ai_configs')
    .select('agent_name')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !data) return null
  const name = ((data as { agent_name?: string | null }).agent_name ?? '').trim()
  return name || null
}

/**
 * The one call a send path makes: hand it the text it was about to send and
 * get back the text to actually send. Returns the input untouched when the
 * feature is off, the type is not signable, or anything at all goes wrong.
 */
export async function signOutgoingText(args: {
  db: SupabaseClient
  accountId: string
  messageType: string
  text: string | null | undefined
  /** `messages.sender_id` — the teammate this message is attributed to. */
  senderId?: string | null
  /** Defaults to `{ kind: 'member', userId: senderId }`. */
  sender?: SignatureSender
}): Promise<string | null | undefined> {
  const { db, accountId, messageType, text, senderId } = args
  try {
    if (typeof text !== 'string' || text.trim() === '') return text
    if (!SIGNABLE_MESSAGE_TYPES.has(messageType)) return text

    const settings = await loadAccountSignature(db, accountId)
    if (!settings.enabled) return text

    const sender: SignatureSender =
      args.sender ?? { kind: 'member', userId: senderId }
    const agentName =
      sender.kind === 'member'
        ? await resolveSenderName(db, sender.userId ?? null)
        : sender.kind === 'ai'
          ? await resolveAiAgentName(db, accountId)
          : null

    const signature = renderSignature(
      settings.template,
      { agentName, businessName: settings.businessName },
      // The assistant never borrows the account's name for `{{ agent_name }}`.
      { fallbackAgentName: sender.kind !== 'ai' },
    )
    if (!signature) return text

    return appendSignature(text, signature)
  } catch (err) {
    console.warn('[signature] skipped:', err instanceof Error ? err.message : err)
    return text
  }
}
