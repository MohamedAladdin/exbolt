// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic' | 'openai_compatible'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  /** Base URL for OpenAI-compatible providers; null for native providers. */
  baseUrl: string | null
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Recent thread messages sent with each reply (4–50). */
  contextMessageLimit: number
  /** Who gets alerted when auto-reply hands a conversation off. The first
   *  entry also becomes the assignee; everyone on the list is notified.
   *  Empty = notify every owner/admin/agent (the shared queue). */
  handoffAgentIds: string[]
  /** The assistant's own working window (Agents → Setup → schedule),
   *  independent of the team's business hours used by the response-time
   *  metric. `scheduleEnabled: false` means "always available". */
  scheduleEnabled: boolean
  scheduleStart: string
  scheduleEnd: string
  /** `extract(dow)` numbering: 0 = Sunday … 6 = Saturday. */
  scheduleDays: number[]
  scheduleTimezone: string
  /** What the auto-reply does outside the schedule:
   *  `always` answers 24/7, `silent` says nothing, `message` sends one
   *  canned reply per thread and then stays quiet. */
  outsideHoursMode: OutsideHoursMode
  /** Canned reply for `message` mode; null falls back to a default. */
  outsideHoursMessage: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
}

export type OutsideHoursMode = 'always' | 'silent' | 'message'

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
