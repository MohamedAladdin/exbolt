// ============================================================
// POST /api/whatsapp/messages/{id}/edit — correct a message.
//
// The WhatsApp Cloud API has no edit endpoint, so this route serves the
// two honest shapes the product supports (see lib/whatsapp/message-edit):
//
//   • a FAILED message (nothing was delivered) is replaced IN PLACE —
//     same row, corrected text, new wamid, `edited_at` stamped;
//   • a DELIVERED message gets a CORRECTION: a new message quoting the
//     original, with the original stamped `edited_at` +
//     `correction_message_id` so the thread can show «صُحّحت».
//
// Authorization is the same as sending (agent role) — editing is a send.
// ============================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

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
  buildCorrectionText,
  editModeFor,
  normalizeEditText,
} from '@/lib/whatsapp/message-edit'
import { LOCALE_COOKIE, resolveLocale } from '@/i18n/config'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    // Editing re-sends, so it shares the send budget — otherwise the
    // edit path would be a way around the per-user send rate limit.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const normalized = normalizeEditText(body?.content_text)
    if (!normalized.text) {
      return NextResponse.json(
        {
          error:
            normalized.reason === 'too_long'
              ? t('inbox.editTooLong', { max: 4096 })
              : t('inbox.editEmpty'),
          code: normalized.reason === 'too_long' ? 'too_long' : 'empty',
        },
        { status: 400 }
      )
    }

    // RLS scopes this to the caller's account; a foreign id reads as null.
    const { data: message } = await supabase
      .from('messages')
      .select(
        'id, conversation_id, sender_type, status, content_type, content_text, reply_to_message_id'
      )
      .eq('id', id)
      .maybeSingle()

    if (!message) {
      return NextResponse.json(
        { error: t('common.notFound'), code: 'not_found' },
        { status: 404 }
      )
    }

    const mode = editModeFor(message as never)
    if (mode === 'blocked') {
      return NextResponse.json(
        { error: t('inbox.editInbound'), code: 'inbound' },
        { status: 400 }
      )
    }

    if (mode === 'in_place') {
      const result = await sendMessageToConversation(
        supabase,
        accountId,
        {
          conversationId: message.conversation_id,
          messageType: 'text',
          contentText: normalized.text,
          replyToMessageId: message.reply_to_message_id ?? null,
          senderId: userId,
        },
        { replaceMessageId: message.id }
      )
      return NextResponse.json({
        success: true,
        mode,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
      })
    }

    // Delivered already — the only truthful action is a correction.
    const locale = resolveLocale(
      (await cookies()).get(LOCALE_COOKIE)?.value,
      process.env.NEXT_PUBLIC_APP_LOCALE
    )

    const result = await sendMessageToConversation(supabase, accountId, {
      conversationId: message.conversation_id,
      messageType: 'text',
      contentText: buildCorrectionText(normalized.text, locale),
      replyToMessageId: message.id,
      senderId: userId,
    })

    // Stamp the original. Best-effort: the correction already landed, so
    // a failed marker write must not turn a successful send into an error.
    const { error: markErr } = await supabase
      .from('messages')
      .update({
        edited_at: new Date().toISOString(),
        correction_message_id: result.messageId,
      })
      .eq('id', message.id)
    if (markErr) {
      console.error('[messages/edit] could not stamp original:', markErr.message)
    }

    return NextResponse.json({
      success: true,
      mode,
      message_id: result.messageId,
      corrected_message_id: message.id,
      whatsapp_message_id: result.whatsappMessageId,
    })
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('Error in message edit POST:', err)
    return toErrorResponse(err)
  }
}
