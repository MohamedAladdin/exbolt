import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  getSubscribedApps,
  listWabaPhoneNumbers,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import {
  explainMetaError,
  metaErrorPayload,
  type MetaConnectStep,
  type MetaErrorContext,
} from '@/lib/whatsapp/meta-error-explain'
import {
  appSubscriptionState,
  describeWabaPhoneMismatch,
  isNumericMetaId,
  phoneNumberBelongsToWaba,
} from '@/lib/whatsapp/waba-pairing'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  getWhatsAppConfigs,
  pickDefaultConfig,
  type WhatsAppConfigRow,
} from '@/lib/whatsapp/config-resolver'
import { requireWithinLimit } from '@/lib/plans/guard'
import { resolveVerifyTokenForSave } from '@/lib/whatsapp/verify-token'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * Resolve the caller's account_id from their profile. Inlined here
 * (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// Lazy-initialised service-role client. We need it to detect a
// phone_number_id already claimed by a *different* user — under RLS,
// the user's own session can't see other users' rows, so the conflict
// would be invisible without the service role.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * Shape every failed Meta call into `{ error, meta }` — the actionable
 * text plus the code / subcode / fbtrace_id / step a user can quote to
 * Meta support. Status is 400 when the fix is on the user's side (token,
 * ids, PIN) and 502 when Meta has to change something (issue #505).
 */
function metaFailure(err: unknown, step: MetaConnectStep, ctx: MetaErrorContext) {
  const explained = explainMetaError(err, step, ctx)
  console.error(`[whatsapp/config] Meta ${step} failed:`, explained.metaMessage, {
    code: explained.code,
    subcode: explained.subcode,
    fbtrace_id: explained.fbtraceId,
  })
  return NextResponse.json(
    { error: explained.summary, meta: metaErrorPayload(explained) },
    { status: explained.httpStatus },
  )
}

/** Public shape of one number in the multi-number list. */
function serializeNumber(row: WhatsAppConfigRow) {
  return {
    id: row.id as string,
    phone_number_id: row.phone_number_id as string,
    // What the operator recognises: +201068910995 · Hemocure.
    display_phone_number:
      (row.display_phone_number as string | null) ?? null,
    verified_name: (row.verified_name as string | null) ?? null,
    waba_id: (row.waba_id as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    is_default: row.is_default === true,
    registered_at: (row.registered_at as string | null) ?? null,
    connected_at: (row.connected_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    last_registration_error:
      (row.last_registration_error as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
  }
}

/** Channels already in use = WhatsApp numbers + active social channels. */
async function channelsInUse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
): Promise<number> {
  const numbers = await getWhatsAppConfigs(supabase, accountId)
  const { count } = await supabase
    .from('channel_configs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('is_active', true)
  return numbers.length + (count ?? 0)
}

/**
 * Fill `display_phone_number` / `verified_name` for rows that never got
 * them (every row saved before migration 077). Runs at most three Graph
 * lookups per request and only when a row is missing data, so the cost
 * is one-off per number. Failures are silent — the list still renders
 * with the Meta id, and the next load retries.
 */
async function backfillDisplayIdentity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  rows: WhatsAppConfigRow[],
): Promise<void> {
  const missing = rows
    .filter((row) => !row.display_phone_number && row.access_token)
    .slice(0, 3);

  for (const row of missing) {
    try {
      const info = await verifyPhoneNumber({
        phoneNumberId: row.phone_number_id,
        accessToken: decrypt(row.access_token),
      });
      const display = info.display_phone_number ?? null;
      const name = info.verified_name ?? null;
      row.display_phone_number = display;
      row.verified_name = name;
      await supabase
        .from('whatsapp_config')
        .update({ display_phone_number: display, verified_name: name })
        .eq('id', row.id);
    } catch (err) {
      console.error(
        '[whatsapp/config GET] display identity lookup failed:',
        row.phone_number_id,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...},
 *     waba_subscription: { checked, subscribed, app_id_match, error? } }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...',
 *     meta: { code, subcode, fbtrace_id, step, field, message } }
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: t('common.profileNotLinked'),
        },
        { status: 200 },
      )
    }

    // Multi-number (migration 075): an account can hold several
    // numbers. The list is always returned; the health probe below runs
    // against the default number only.
    const rows = await getWhatsAppConfigs(supabase, accountId)
    await backfillDisplayIdentity(supabase, rows)
    const numbers = rows.map(serializeNumber)
    const config = pickDefaultConfig(rows)

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: t('whatsappConfig.noConfig'),
          numbers,
        },
        { status: 200 }
      )
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            t('whatsappConfig.tokenCorrupted'),
          config_id: config.id,
          numbers,
        },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
    } catch (err) {
      const explained = explainMetaError(err, 'verify_number', {
        phoneNumberId: config.phone_number_id,
        wabaId: config.waba_id,
      })
      console.error('[whatsapp/config GET] Meta API verification failed:', explained.metaMessage)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: explained.summary,
          meta: metaErrorPayload(explained),
          config_id: config.id,
          numbers,
        },
        { status: 200 }
      )
    }

    // Credentials work. Also report whether the WABA is subscribed to
    // this app — valid credentials with an unsubscribed WABA is exactly
    // the "connected but no messages arrive" state (issue #505). Never
    // fatal: the token may lack whatsapp_business_management and still
    // be fine for sending.
    let wabaSubscription: {
      checked: boolean
      subscribed: boolean | null
      app_id_match: boolean | null
      error?: string
    } = { checked: false, subscribed: null, app_id_match: null }
    if (config.waba_id) {
      try {
        const subs = await getSubscribedApps({ wabaId: config.waba_id, accessToken })
        const state = appSubscriptionState(subs, process.env.META_APP_ID)
        wabaSubscription = {
          checked: true,
          subscribed: state.subscribed,
          app_id_match: state.appIdMatch,
        }
      } catch (err) {
        const explained = explainMetaError(err, 'subscribed_apps', { wabaId: config.waba_id })
        wabaSubscription = {
          checked: true,
          subscribed: null,
          app_id_match: null,
          error: explained.summary,
        }
      }
    }

    return NextResponse.json({
      connected: true,
      phone_info: phoneInfo,
      waba_subscription: wabaSubscription,
    })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: t('common.internalServerError') },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 *
 * Every Meta failure answers `{ error, meta: { code, subcode,
 * fbtrace_id, step, field, message } }` — `error` is the actionable
 * text, `meta` is what to quote to Meta support. 400 = fix it on the
 * form (token / ids / PIN), 502 = Meta has to change something.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`whatsapp-admin:${userId}`, RATE_LIMITS.whatsappAdmin)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const {
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
      // Multi-number: edit THIS number instead of the account's only row,
      // and optionally promote it to default on save.
      config_id,
      is_default,
    } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: t('whatsappConfig.credentialsRequired') },
        { status: 400 }
      )
    }

    // Meta ids are decimal digit strings. Catch the classic paste
    // mistakes (the +phone number, a display name, a URL) here with a
    // named field, instead of letting Meta answer "(#100) Unsupported
    // get request" for a value we could have rejected up front.
    if (!isNumericMetaId(phone_number_id)) {
      return NextResponse.json(
        {
          error:
            t('whatsappConfig.phoneIdDigits'),
          field: 'phone_number_id',
        },
        { status: 400 }
      )
    }
    if (waba_id !== undefined && waba_id !== null && waba_id !== '' && !isNumericMetaId(waba_id)) {
      return NextResponse.json(
        {
          error:
            t('whatsappConfig.wabaIdDigits'),
          field: 'waba_id',
        },
        { status: 400 }
      )
    }
    const metaCtx: MetaErrorContext = { phoneNumberId: phone_number_id, wabaId: waba_id || null }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: t('whatsappConfig.pinDigits') },
          { status: 400 }
        )
      }
    }

    // Reject if another account has already claimed this phone_number_id.
    // ExBolt is single-tenant-per-WhatsApp-number — letting two accounts
    // bind the same number causes the webhook's `.single()` lookup to
    // throw PGRST116 ("multiple rows"), silently dropping every
    // inbound message. See issue #136. Post-multi-user we key on
    // account_id (not user_id) since teammates inside the same account
    // all share one config; the conflict is between accounts.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phone_number_id)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError)
      return NextResponse.json(
        { error: t('whatsappConfig.validateFailed') },
        { status: 500 }
      )
    }

    if (claimed) {
      return NextResponse.json(
        {
          error:
            t('whatsappConfig.numberLinkedElsewhere'),
        },
        { status: 409 }
      )
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      return metaFailure(err, 'verify_number', metaCtx)
    }

    // The number resolves — now make sure it lives under the WABA the
    // user typed. A foreign-but-valid WABA ID used to save fine and
    // subscribe the *wrong* account, surfacing days later as a webhook
    // that never fires. Failing here names the mismatch instead.
    if (waba_id) {
      let wabaNumbers
      try {
        wabaNumbers = await listWabaPhoneNumbers({
          wabaId: waba_id,
          accessToken: access_token,
        })
      } catch (err) {
        return metaFailure(err, 'waba_phone_numbers', metaCtx)
      }
      if (!phoneNumberBelongsToWaba(wabaNumbers, phone_number_id)) {
        return NextResponse.json(
          {
            error: describeWabaPhoneMismatch(wabaNumbers, phone_number_id, waba_id),
            field: 'waba_id',
            meta: {
              code: null,
              subcode: null,
              fbtrace_id: null,
              step: 'waba_phone_numbers',
              field: 'waba_id',
              message: 'phone_number_id is not listed under waba_id',
            },
          },
          { status: 400 }
        )
      }
    }

    // Look up any pre-existing row for this account. Two reasons: we need
    // to know whether this number is already registered with Meta (so we
    // can skip /register when the user didn't provide a PIN this time
    // around), and we need the stored verify_token — the settings form
    // never shows it, so a save that leaves the field blank must keep it
    // rather than null it out.
    // Multi-number lookup: an explicit `config_id` edits that row; a
    // matching phone_number_id re-saves it (idempotent retry); anything
    // else is a NEW number.
    const accountNumbers = await getWhatsAppConfigs(supabase, accountId)
    const existing = config_id
      ? accountNumbers.find((row) => row.id === config_id) ?? null
      : accountNumbers.find((row) => row.phone_number_id === phone_number_id) ??
        null

    if (config_id && !existing) {
      return NextResponse.json(
        { error: t('whatsappConfig.numberNotFound') },
        { status: 404 }
      )
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = resolveVerifyTokenForSave(
        verify_token,
        existing?.verify_token ?? null
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            t('whatsappConfig.encryptFailed'),
        },
        { status: 500 }
      )
    }

    const sameNumber =
      existing?.phone_number_id === phone_number_id &&
      existing?.registered_at != null

    // Step 1: register the phone number for inbound webhooks.
    //
    // Attempted on first save AND whenever the user supplies a fresh
    // PIN (e.g. they rotated the 2FA PIN in Meta Manager). Skipped
    // when the same number is already registered and no PIN was
    // supplied — re-registering an already-active number with a
    // stale PIN would actually fail and undo the active subscription.
    let registeredAt: string | null = existing?.registered_at ?? null
    let registrationError: string | null = null
    let registrationMeta: ReturnType<typeof metaErrorPayload> | null = null
    // True when registration was deliberately skipped because no PIN
    // was supplied (see below). Distinct from registrationError — this
    // is not a failure, just an incomplete-but-valid save.
    let registrationSkipped = false

    const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)
    if (needsRegistration) {
      if (!pin) {
        // No PIN provided. Meta TEST numbers (Developer Console) are
        // pre-registered by Meta and expose no two-step verification
        // PIN to set, so requiring one made them impossible to connect
        // (issue #242). The /register + PIN step only matters for
        // production numbers under a shared WABA (issue #136), so treat
        // it as best-effort: skip it, save the (already Meta-verified)
        // credentials as connected, and leave registered_at null. The
        // UI surfaces a separate "Not registered" banner with a path to
        // add a PIN later for users who do need inbound webhook routing.
        registrationSkipped = true
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          })
          registeredAt = new Date().toISOString()
        } catch (err) {
          const explained = explainMetaError(err, 'register', metaCtx)
          registrationError = explained.summary
          registrationMeta = metaErrorPayload(explained)
          console.error('Phone number /register failed:', explained.metaMessage, registrationMeta)
          // We deliberately fall through and still save the row so the
          // user can retry without re-entering everything. The UI
          // surfaces `last_registration_error` so they see WHY it's
          // not actually live yet.
        }
      }
    }

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's
    // side, so we call on every save and persist the timestamp.
    // Skipped only when there's no waba_id (legacy rows from before
    // we required it).
    //
    // A failure here used to be swallowed with a console.warn, which
    // left the user with a green "connected" banner and a webhook that
    // never fired. Without this subscription Meta delivers nothing, so
    // treat it as a failed connect and say why (issue #505). Nothing
    // has been written yet, so the user just fixes the cause and saves
    // again.
    let subscribedAppsAt: string | null = null
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        return metaFailure(err, 'subscribe_waba', metaCtx)
      }
    }

    // Persist everything in one shot. If /register failed we still
    // store the credentials and the error so the UI can guide the
    // user through a retry.
    const baseRow = {
      phone_number_id,
      // Read straight from the Graph probe above — free, and it is the
      // only place the human number is known until the next refresh.
      display_phone_number: phoneInfo.display_phone_number ?? null,
      verified_name: phoneInfo.verified_name ?? null,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    }

    // Billing: every number is a channel slot (GROWTH = 4). The check
    // runs only when a row would be ADDED, so re-saving an existing
    // number never trips the limit.
    if (!existing) {
      await requireWithinLimit(
        'channels',
        await channelsInUse(supabase, accountId),
      )
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('id', existing.id)
        .eq('account_id', accountId)

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: t('whatsappConfig.updateFailed') },
          { status: 500 }
        )
      }
    } else {
      // Insert with both columns: `account_id` is the tenancy key
      // (NOT NULL post-017, UNIQUE so duplicates trip the constraint
      // up-front), `user_id` is the audit column identifying which
      // member of the account saved the config.
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: userId,
          // The first number of an account is its default; later ones
          // inherit the flag only when the caller asks for it below.
          is_default: accountNumbers.length === 0 || is_default === true,
          ...baseRow,
        })

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: t('whatsappConfig.saveFailed') },
          { status: 500 }
        )
      }
    }

    // Default-number bookkeeping. The partial unique index allows one
    // default per account, so the others are cleared first.
    const savedRow = (
      await getWhatsAppConfigs(supabase, accountId)
    ).find((row) => row.phone_number_id === phone_number_id)

    const wantsDefault =
      is_default === true ||
      existing?.is_default === true ||
      accountNumbers.length === 0

    if (savedRow && wantsDefault && savedRow.is_default !== true) {
      await supabase
        .from('whatsapp_config')
        .update({ is_default: false })
        .eq('account_id', accountId)
        .neq('id', savedRow.id)
      await supabase
        .from('whatsapp_config')
        .update({ is_default: true })
        .eq('id', savedRow.id)
        .eq('account_id', accountId)
    }

    const numbers = (await getWhatsAppConfigs(supabase, accountId)).map(
      serializeNumber,
    )

    if (registrationError) {
      // Save succeeded but the number isn't actually live. Return
      // 200 with a structured error so the UI can show the specific
      // remediation step instead of a generic toast.
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        error: registrationError,
        meta: registrationMeta,
        phone_info: phoneInfo,
        config_id: savedRow?.id ?? null,
        numbers,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      // Credentials are valid and saved, but inbound webhook
      // registration was skipped because no PIN was supplied (e.g. a
      // Meta test number). The UI shows the "Not registered" banner
      // rather than claiming the number is fully live.
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
      config_id: savedRow?.id ?? null,
      numbers,
    })
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError ||
      (error instanceof Error && error.name === 'PlanError')
    ) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config?id=<config_id>
 *
 * Removes ONE number. Without `id` the whole account is disconnected
 * (the old “Reset configuration” behaviour). Deleting the default
 * promotes the oldest remaining number so sends never lose their
 * fallback.
 */
export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = new URL(request.url).searchParams.get('id')

    const query = supabase.from('whatsapp_config').delete().eq('account_id', accountId)
    const { error: deleteError } = id
      ? await query.eq('id', id)
      : await query

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json(
        { error: t('whatsappConfig.deleteFailed') },
        { status: 500 }
      )
    }

    // Promote a survivor when the deleted row was the default.
    const remaining = await getWhatsAppConfigs(supabase, accountId)
    if (remaining.length > 0 && !remaining.some((row) => row.is_default)) {
      const oldest = pickDefaultConfig(remaining)
      if (oldest) {
        await supabase
          .from('whatsapp_config')
          .update({ is_default: true })
          .eq('id', oldest.id)
          .eq('account_id', accountId)
      }
    }

    const numbers = (await getWhatsAppConfigs(supabase, accountId)).map(
      serializeNumber,
    )
    return NextResponse.json({ success: true, numbers })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/config  { config_id }
 *
 * Promotes one number to the account default — the number a send
 * without an explicit choice leaves from.
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { config_id } = await request.json()

    if (!config_id) {
      return NextResponse.json(
        { error: t('whatsappConfig.numberIdRequired') },
        { status: 400 }
      )
    }

    const rows = await getWhatsAppConfigs(supabase, accountId)
    if (!rows.some((row) => row.id === config_id)) {
      return NextResponse.json(
        { error: t('whatsappConfig.numberNotFound') },
        { status: 404 }
      )
    }

    await supabase
      .from('whatsapp_config')
      .update({ is_default: false })
      .eq('account_id', accountId)
      .neq('id', config_id)
    const { error } = await supabase
      .from('whatsapp_config')
      .update({ is_default: true })
      .eq('id', config_id)
      .eq('account_id', accountId)

    if (error) {
      console.error('Error promoting whatsapp_config:', error)
      return NextResponse.json(
        { error: t('whatsappConfig.updateFailed') },
        { status: 500 }
      )
    }

    const numbers = (await getWhatsAppConfigs(supabase, accountId)).map(
      serializeNumber,
    )
    return NextResponse.json({ success: true, numbers })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp config PATCH:', error)
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
  }
}
