import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { requireFeature, requireWithinLimit } from '@/lib/plans/guard'
import { countActiveChannels } from '@/lib/plans/usage'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import { isMessagingChannel, type MessagingChannel } from '@/lib/channels/types'
import { graphUrl, subscribePageToApp } from '@/lib/channels/graph-api'

/**
 * Messenger / Instagram channel connections for the current account.
 *
 * GET    — list the connected channels (never the token).
 * POST   — connect or re-connect one channel: verifies the Page/IG id +
 *          token against Graph, subscribes the app to the Page's message
 *          webhook, then stores the token encrypted (same AES-256-GCM
 *          helper as whatsapp_config).
 * DELETE — disconnect (`?channel=messenger|instagram`).
 *
 * WhatsApp is NOT here: it keeps its own `whatsapp_config` table and
 * `/api/whatsapp/config` route.
 */

interface PublicChannelConfig {
  channel: MessagingChannel
  external_id: string
  display_name: string | null
  is_active: boolean
  updated_at: string | null
}

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    // RLS (channel_configs_select) scopes to the caller's account.
    const { data, error } = await supabase
      .from('channel_configs')
      .select('channel, external_id, display_name, is_active, updated_at')
      .order('channel', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ channels: (data ?? []) as PublicChannelConfig[] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireFeature('multi_channel', 'admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const channel = body.channel
  if (!isMessagingChannel(channel)) {
    return NextResponse.json(
      { error: 'channel must be "messenger" or "instagram"' },
      { status: 400 },
    )
  }

  const externalId = typeof body.external_id === 'string' ? body.external_id.trim() : ''
  if (!/^\d{5,25}$/.test(externalId)) {
    return NextResponse.json(
      {
        error:
          channel === 'messenger'
            ? 'external_id must be the numeric Facebook Page ID'
            : 'external_id must be the numeric Instagram business account ID',
      },
      { status: 400 },
    )
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''
  if (accessToken.length < 20) {
    return NextResponse.json(
      { error: 'access_token looks too short — paste the Page access token' },
      { status: 400 },
    )
  }

  // Verify before storing: a wrong token or a Page the admin does not
  // manage must fail here, not silently at the first inbound message.
  let displayName: string | null = null
  try {
    const url = new URL(graphUrl(externalId))
    url.searchParams.set('fields', 'name')
    url.searchParams.set('access_token', accessToken)
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const payload = (await res.json().catch(() => ({}))) as {
      name?: string
      error?: { message?: string }
    }
    if (!res.ok || payload.error) {
      return NextResponse.json(
        {
          error:
            payload.error?.message ||
            `Meta rejected the credentials (HTTP ${res.status})`,
        },
        { status: 400 },
      )
    }
    displayName = payload.name ?? null
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not reach Meta to verify the credentials: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      },
      { status: 502 },
    )
  }

  // Plan gate: every channel is a billable slot. Re-connecting a channel that
  // already exists is an update (no new slot), so only a genuinely new channel
  // is checked against `limits.channels`.
  const { data: existingChannels } = await supabaseAdmin()
    .from('channel_configs')
    .select('id, channel')
    .eq('account_id', ctx.accountId)
  const alreadyConnected = (
    (existingChannels ?? []) as { channel?: string }[]
  ).some((row) => row.channel === channel)
  if (!alreadyConnected) {
    try {
      await requireWithinLimit(
        'channels',
        await countActiveChannels(supabaseAdmin(), ctx.accountId)
      )
    } catch (err) {
      return toErrorResponse(err)
    }
  }

  // Subscribe the Page to this app's message webhook. Idempotent — Meta
  // returns 200 when the subscription already exists.
  const subscribed = await subscribePageToApp({ externalId, accessToken })

  const { error } = await supabaseAdmin()
    .from('channel_configs')
    .upsert(
      {
        account_id: ctx.accountId,
        channel,
        external_id: externalId,
        display_name: displayName,
        access_token: encrypt(accessToken),
        is_active: true,
        last_error: subscribed.ok
          ? null
          : (subscribed.error ?? 'subscription failed'),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,channel' },
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    channel: {
      channel,
      external_id: externalId,
      display_name: displayName,
      is_active: true,
    },
    subscribed: subscribed.ok,
    subscribe_error: subscribed.ok ? null : subscribed.error ?? 'subscription failed',
  })
}

export async function DELETE(request: Request) {
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const channel = new URL(request.url).searchParams.get('channel')
  if (!isMessagingChannel(channel)) {
    return NextResponse.json(
      { error: 'channel must be "messenger" or "instagram"' },
      { status: 400 },
    )
  }

  const { error } = await supabaseAdmin()
    .from('channel_configs')
    .delete()
    .eq('account_id', ctx.accountId)
    .eq('channel', channel)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
