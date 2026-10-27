// ============================================================
// GET /api/whatsapp/forward/targets — the conversations a message can be
// forwarded into.
//
// Bounded, account-scoped read used by the forward dialog's picker: the
// 30 most recently active threads, filtered client-side by name/phone.
// `exclude` drops the conversation the message already lives in.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

const TARGET_LIMIT = 30
const SCAN_LIMIT = 300

interface ContactRef {
  id: string
  name: string | null
  phone: string | null
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const exclude = url.searchParams.get('exclude')

    // NULLs last: a conversation created but never messaged has a null
    // last_message_at and Postgres sorts those FIRST on DESC (same trap
    // the inbox list had), which would push real threads off the page.
    const { data, error } = await supabase
      .from('conversations')
      .select('id, channel, last_message_at, contact:contacts(id, name, phone)')
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(SCAN_LIMIT)

    if (error) {
      console.error('[forward/targets] query failed:', error.message)
      return NextResponse.json({ targets: [] })
    }

    const targets = (data ?? [])
      .filter((row) => row.id !== exclude)
      .map((row) => {
        const contact = row.contact as unknown as ContactRef | null
        return {
          conversation_id: row.id as string,
          channel: (row.channel ?? 'whatsapp') as string,
          contact_id: contact?.id ?? null,
          name: contact?.name ?? null,
          phone: contact?.phone ?? null,
          last_message_at: row.last_message_at as string | null,
        }
      })
      .filter((row) => {
        if (!query) return true
        const haystack = `${row.name ?? ''} ${row.phone ?? ''}`.toLowerCase()
        return haystack.includes(query)
      })
      .slice(0, TARGET_LIMIT)

    return NextResponse.json({ targets })
  } catch (err) {
    return toErrorResponse(err)
  }
}
