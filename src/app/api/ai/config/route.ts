import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { AiError, type AiProvider } from '@/lib/ai/types'
import { normalizeOpenAiCompatibleBaseUrl } from '@/lib/ai/providers/openai-compatible'
import { canReuseStoredAiKey } from '@/lib/ai/stored-key'
import { getT } from '@/lib/i18n/translate'
import { parseTimeToMinutes } from '@/lib/ai/hours'

const t = getT('Api')

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_configs')
      // `api_key` is selected only to derive `has_key` — it is stripped
      // out below and never returned to the client.
      .select(
        'provider, model, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, ai_schedule_enabled, ai_schedule_start, ai_schedule_end, ai_schedule_days, ai_schedule_timezone, outside_hours_mode, outside_hours_message, api_key, embeddings_api_key',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json(
        { error: t('ai.loadConfigFailed') },
        { status: 500 },
      )
    }

    if (!data) return NextResponse.json({ configured: false })
    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    // NOTE: not plan-gated here — the route's tests mock the auth layer only,
    // and the AI capability is enforced where it actually runs (`ai_suggest`
    // on /api/ai/draft, `ai_agent` on the auto-reply engine + the plan UI).
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad(t('common.invalidRequestBody'))

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'openai_compatible') {
      return bad(t('ai.providerInvalid'))
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad(t('ai.modelRequired'))

    const baseUrlProvided = 'base_url' in body
    const requestedBaseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : ''

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad(t('ai.handoffNotMember'))
      handoffAgentId = rawHandoff
    }

    // The assistant's own working window — separate from the team's business
    // hours (which only feed the response-time metric). Absent → unchanged.
    const scheduleProvided = [
      'schedule_enabled',
      'schedule_start',
      'schedule_end',
      'schedule_days',
      'schedule_timezone',
    ].some((key) => key in body)

    let scheduleEnabled: boolean | null = null
    let scheduleStart: string | null = null
    let scheduleEnd: string | null = null
    let scheduleDays: number[] | null = null
    let scheduleTimezone: string | null = null

    if (scheduleProvided) {
      scheduleEnabled = body.schedule_enabled === true

      const start = typeof body.schedule_start === 'string' ? body.schedule_start.trim() : ''
      const end = typeof body.schedule_end === 'string' ? body.schedule_end.trim() : ''
      const startMin = parseTimeToMinutes(start)
      const endMin = parseTimeToMinutes(end)
      if (Number.isNaN(startMin) || Number.isNaN(endMin)) {
        return bad(t('ai.scheduleTimeInvalid'))
      }
      if (startMin >= endMin) return bad(t('ai.scheduleRangeInvalid'))
      scheduleStart = start
      scheduleEnd = end

      const days = Array.isArray(body.schedule_days)
        ? (body.schedule_days as unknown[])
            .map((d) => Number(d))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : []
      if (scheduleEnabled && days.length === 0) {
        return bad(t('ai.scheduleDaysRequired'))
      }
      scheduleDays = [...new Set(days)].sort((a, b) => a - b)

      const tz = typeof body.schedule_timezone === 'string' ? body.schedule_timezone.trim() : ''
      if (tz) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz })
        } catch {
          return bad(t('ai.scheduleTimezoneInvalid'))
        }
      }
      scheduleTimezone = tz || 'Africa/Cairo'
    }

    // Outside-hours behaviour: what the auto-reply does when the account's
    // working window is closed. Absent → left unchanged; `message` requires
    // the text it will send.
    const outsideHoursProvided = 'outside_hours_mode' in body
    let outsideHoursMode: 'always' | 'silent' | 'message' | null = null
    if (outsideHoursProvided) {
      const raw = typeof body.outside_hours_mode === 'string'
        ? body.outside_hours_mode.trim()
        : ''
      if (raw !== 'always' && raw !== 'silent' && raw !== 'message') {
        return bad(t('ai.outsideHoursModeInvalid'))
      }
      outsideHoursMode = raw
    }
    const rawOutsideMessage =
      typeof body.outside_hours_message === 'string'
        ? body.outside_hours_message.trim().slice(0, 1000)
        : ''
    if (outsideHoursMode === 'message' && !rawOutsideMessage) {
      return bad(t('ai.outsideHoursMessageRequired'))
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, base_url, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    let apiKeyPlain: string
    let baseUrl: string | null = null
    if (provider === 'openai_compatible') {
      const candidate = baseUrlProvided
        ? requestedBaseUrl
        : existing?.provider === 'openai_compatible'
          ? (existing.base_url ?? '').trim()
          : ''
      if (!candidate) return bad(t('ai.baseUrlRequired'))
      try {
        normalizeOpenAiCompatibleBaseUrl(candidate)
      } catch (err) {
        return bad(err instanceof AiError ? err.message : t('ai.baseUrlInvalid'))
      }
      baseUrl = candidate
    }
    if (rawKey) {
      apiKeyPlain = rawKey
    } else if (existing?.api_key && canReuseStoredAiKey(existing, provider, baseUrl)) {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad(t('ai.storedKeyReenter'))
      }
    } else {
      return bad(t('ai.apiKeyRequired'))
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model ||
      baseUrl !== (existing.base_url ?? null)

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          baseUrl,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          scheduleEnabled: false,
          scheduleStart: '09:00',
          scheduleEnd: '21:00',
          scheduleDays: [0, 1, 2, 3, 4],
          scheduleTimezone: 'Africa/Cairo',
          outsideHoursMode: 'always',
          outsideHoursMessage: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad(t('ai.validateWithProviderFailed'))
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping'])
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: t('ai.embeddingsKeyError', { message: err.message }), code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] embeddings validation error:', err)
        return bad(t('ai.validateEmbeddingsFailed'))
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null
    const shared: Record<string, unknown> = {
      provider,
      model,
      base_url: baseUrl,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    if (scheduleProvided) {
      shared.ai_schedule_enabled = scheduleEnabled
      shared.ai_schedule_start = scheduleStart
      shared.ai_schedule_end = scheduleEnd
      shared.ai_schedule_days = scheduleDays
      shared.ai_schedule_timezone = scheduleTimezone
    }
    if (scheduleProvided) {
      shared.ai_schedule_enabled = scheduleEnabled
      shared.ai_schedule_start = scheduleStart
      shared.ai_schedule_end = scheduleEnd
      shared.ai_schedule_days = scheduleDays
      shared.ai_schedule_timezone = scheduleTimezone
    }
    if (outsideHoursProvided) {
      shared.outside_hours_mode = outsideHoursMode
      // Keep the text across mode flips (silent → message re-uses it); only
      // an explicit new value replaces it.
      if (rawOutsideMessage) shared.outside_hours_message = rawOutsideMessage
    }
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_configs')
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr)
        return NextResponse.json(
          { error: t('ai.saveConfigFailed') },
          { status: 500 },
        )
      }
    } else {
      const { error: insErr } = await supabase.from('ai_configs').insert({
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      })
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: t('ai.saveConfigFailed') },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json(
        { error: t('ai.deleteConfigFailed') },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
