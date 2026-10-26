import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'

/**
 * Contact card for a phone number picked out of a message body.
 *
 * The inbox links every phone number in a thread; hovering/clicking one
 * shows whatever we already know about that person, without the agent
 * leaving the conversation. This route is that lookup — read-only on
 * purpose: it never creates a contact (that only happens when the agent
 * explicitly opens a chat, see /api/contacts/open-chat).
 *
 * `?phone=` accepts an international number (`+2010…`) or the digits form
 * the detector produced. Resolution is fuzzy the same way the contact form
 * is (trunk-prefix tolerant), so `+20 101 234 5678` finds a contact stored
 * as `201012345678`.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const raw = new URL(request.url).searchParams.get('phone') ?? ''
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 6) {
      return NextResponse.json({ error: 'A phone number is required' }, { status: 400 })
    }

    // Prefer the validated international form when we have one — it is
    // what every other write path stores — but fall back to the digits so
    // a locally formatted number still resolves.
    const lookup = parseInternationalPhone(raw) ?? digits

    const contact = await findExistingContact(supabase, accountId, lookup)
    if (!contact) {
      return NextResponse.json({ contact: null, conversation_id: null })
    }

    // Existing thread for this contact, if any — lets the card say
    // "Open conversation" instead of "Start conversation".
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    // Tag names for the card. RLS scopes the join rows to this account.
    const { data: tagRows } = await supabase
      .from('contact_tags')
      .select('tags(name, color)')
      .eq('contact_id', contact.id)

    const tags = (tagRows ?? [])
      .map((row) => row.tags as unknown as { name: string; color: string } | null)
      .filter((tag): tag is { name: string; color: string } => !!tag)

    return NextResponse.json({
      contact: {
        id: contact.id,
        name: contact.name ?? null,
        phone: contact.phone ?? null,
        email: (contact.email as string | null) ?? null,
        company: (contact.company as string | null) ?? null,
        avatar_url: (contact.avatar_url as string | null) ?? null,
        channel: (contact.channel as string | null) ?? 'whatsapp',
        tags,
      },
      conversation_id: (conversation?.id as string | undefined) ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
