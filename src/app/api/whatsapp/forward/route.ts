// ============================================================
// POST /api/whatsapp/forward — forward a message into other chats.
//
// The Cloud API has no forward endpoint (forwarding is a client
// action on WhatsApp), so this route re-sends the source payload into
// each target conversation through the same send core the composer
// uses — which means templates/quota/window/phone-variant rules all
// apply exactly as they do for a normal send.
//
// `forwarded_from_message_id` is written on each new row (the arrow
// marker) and the source row's `forward_count` is bumped.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message'
import {
  forwardPayloadFor,
  normalizeForwardTargets,
} from '@/lib/whatsapp/forward-message'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => ({}))

    if (!body?.message_id) {
      return NextResponse.json(
        { error: t('common.invalidRequestBody'), code: 'message_required' },
        { status: 400 }
      )
    }

    const targets = normalizeForwardTargets(body?.conversation_ids)
    if (targets.length === 0) {
      return NextResponse.json(
        { error: t('inbox.forwardNoTargets'), code: 'no_targets' },
        { status: 400 }
      )
    }

    const { data: source } = await supabase
      .from('messages')
      .select('id, conversation_id, content_type, content_text, media_url, template_name')
      .eq('id', body.message_id)
      .maybeSingle()

    if (!source) {
      return NextResponse.json(
        { error: t('common.notFound'), code: 'not_found' },
        { status: 404 }
      )
    }

    const plan = forwardPayloadFor(source as never)
    if (!plan.payload) {
      const message =
        plan.reason === 'media_unavailable'
          ? t('inbox.forwardMediaUnavailable')
          : plan.reason === 'unsupported'
            ? t('inbox.forwardUnsupported')
            : t('inbox.forwardNoContent')
      return NextResponse.json(
        { error: message, code: plan.reason ?? 'unsupported' },
        { status: 400 }
      )
    }

    // Only forward into conversations this account owns — an id from
    // another tenant reads as missing under RLS, so validate up front
    // and report it per target instead of throwing a 404 for the batch.
    const { data: owned } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .in('id', targets)
    const allowed = new Set((owned ?? []).map((row) => row.id as string))

    const sent: Array<{ conversation_id: string; message_id: string }> = []
    const failed: Array<{ conversation_id: string; error: string }> = []

    for (const conversationId of targets) {
      if (!allowed.has(conversationId)) {
        failed.push({ conversation_id: conversationId, error: 'not_found' })
        continue
      }
      try {
        const result = await sendMessageToConversation(supabase, accountId, {
          conversationId,
          messageType: plan.payload.messageType,
          contentText: plan.payload.contentText,
          mediaUrl: plan.payload.mediaUrl,
          filename: plan.payload.filename,
          senderId: userId,
        })

        // Marker write is best-effort: the message is already delivered,
        // so a failed marker must not report the send as failed.
        const { error: markErr } = await supabase
          .from('messages')
          .update({ forwarded_from_message_id: source.id })
          .eq('id', result.messageId)
        if (markErr) {
          console.error('[forward] marker write failed:', markErr.message)
        }

        sent.push({ conversation_id: conversationId, message_id: result.messageId })
      } catch (err) {
        const reason =
          err instanceof SendMessageError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'unknown'
        console.error('[forward] send failed:', conversationId, reason)
        failed.push({ conversation_id: conversationId, error: reason })
      }
    }

    if (sent.length > 0) {
      const nextCount = ((source as { forward_count?: number }).forward_count ?? 0) + sent.length
      const { error: bumpErr } = await supabase
        .from('messages')
        .update({ forward_count: nextCount })
        .eq('id', source.id)
      if (bumpErr) {
        console.error('[forward] count bump failed:', bumpErr.message)
      }
    }

    if (sent.length === 0) {
      const first = failed[0]
      return NextResponse.json(
        {
          error: first?.error === 'not_found' ? t('common.notFound') : (first?.error ?? t('common.unknownError')),
          code: 'forward_failed',
          failed,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, sent, failed })
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('Error in forward POST:', err)
    return toErrorResponse(err)
  }
}
