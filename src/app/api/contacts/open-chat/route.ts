import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { SendMessageError } from '@/lib/whatsapp/send-message'
import { defaultCountryCode } from '@/lib/contacts/phone-detect'

/**
 * "Chat with this number" from inside a conversation.
 *
 * Clicking a phone number in a thread should not require a detour through
 * Contacts → New contact → save → Inbox → find. This route does the whole
 * find-or-create in one call: it reuses the same resolver the public API
 * uses (so a contact created here is indistinguishable from one created by
 * an inbound message: same dedupe, same account_id/user_id split, same
 * one-conversation-per-contact rule) and returns the conversation id the
 * inbox then deep-links to.
 *
 * Body: `{ phone: string, name?: string }`. A local trunk-0 number is
 * promoted to E.164 with `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` before
 * resolving, because Meta only accepts international form.
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (!raw) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }

  const phone = promoteToInternational(raw)
  if (!phone) {
    return NextResponse.json(
      { error: 'That does not look like a complete phone number.' },
      { status: 400 },
    )
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null

  try {
    const resolved = await resolveConversationByPhone(
      supabaseAdmin(),
      ctx.accountId,
      phone,
      name,
    )
    return NextResponse.json({
      conversation_id: resolved.conversationId,
      contact_id: resolved.contactId,
      contact_created: resolved.contactCreated,
    })
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}

/** `+2010…` stays as-is; `01012345678` becomes `+201012345678`. */
function promoteToInternational(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[\s().-]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (/^0\d{9,10}$/.test(digits)) return `+${defaultCountryCode()}${digits.slice(1)}`;
  if (digits.length >= 9 && digits.length <= 15) return `+${digits}`;
  return null;
}
