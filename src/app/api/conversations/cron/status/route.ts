import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  autoStatusFor,
  normaliseCloseAfterDays,
  type AutoStatusTarget,
  type SweepCandidate,
} from '@/lib/inbox/auto-status'

/**
 * Automatic thread status: `open` → `pending` → `closed`.
 *
 * Meant to be hit on a schedule (same convention as `/api/automations/cron` —
 * a shared secret in `x-cron-secret` matching `AUTOMATION_CRON_SECRET`).
 *
 * `pending` = the customer has been silent past the 24h service window, so a
 * template is the only way back in. `closed` = idle past the account's
 * `auto_close_after_days` (default 7). The classification itself lives in
 * `@/lib/inbox/auto-status` (unit-tested); this route only pages the rows,
 * applies it and reports what it changed.
 *
 * `?dry=1` returns the same counters without writing — the honest way to
 * preview a sweep on a live account.
 *
 * Reopening is NOT this route's job: a customer inbound (or an outbound send
 * on a closed thread) reopens the thread in the database trigger
 * (`reopen_conversation_on_message`, migration 090), so a reply can never slip
 * past a thread that is hidden behind a status.
 */

const PAGE_SIZE = 500
const UPDATE_CHUNK = 100

type ConversationRow = SweepCandidate & { id: string; account_id: string | null }

function authorised(request: Request): boolean {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return false
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  return (
    suppliedBuf.length === expectedBuf.length &&
    timingSafeEqual(suppliedBuf, expectedBuf)
  )
}

async function closeThresholds(
  admin: ReturnType<typeof supabaseAdmin>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const { data, error } = await admin
    .from('accounts')
    .select('id, auto_close_after_days')
  if (error) return map
  for (const row of data ?? []) {
    map.set(row.id as string, normaliseCloseAfterDays(row.auto_close_after_days))
  }
  return map
}

async function applyStatus(
  admin: ReturnType<typeof supabaseAdmin>,
  ids: string[],
  status: Exclude<AutoStatusTarget, null>,
  reason: 'auto_window' | 'auto_idle',
): Promise<number> {
  let changed = 0
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK)
    // One RPC, not an inline update: it flags `status_auto` (so a retired
    // thread never reads as a human resolution) and sets the audit reason the
    // status-history trigger records.
    const { data, error } = await admin.rpc('apply_conversation_status', {
      p_ids: chunk,
      p_status: status,
      p_reason: reason,
    })
    if (error) throw new Error(`update ${status}: ${error.message}`)
    changed += Number(data ?? 0)
  }
  return changed
}

export async function GET(request: Request) {
  if (!process.env.AUTOMATION_CRON_SECRET) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun =
    new URL(request.url).searchParams.get('dry') === '1' ||
    new URL(request.url).searchParams.get('dry') === 'true'

  const admin = supabaseAdmin()
  const now = Date.now()
  const thresholds = await closeThresholds(admin)

  const pending: string[] = []
  const closed: string[] = []
  let scanned = 0
  let from = 0

  // Page over every thread that is not already closed. `range` over a
  // *stable* predicate matters: nothing is written until the whole scan is
  // done, so the window can't shift underneath the offset.
  for (;;) {
    const { data, error } = await admin
      .from('conversations')
      .select('id, account_id, status, last_inbound_at, last_message_at, last_reply_at, unread_count')
      .neq('status', 'closed')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const rows = (data ?? []) as ConversationRow[]
    if (rows.length === 0) break

    scanned += rows.length
    for (const row of rows) {
      const closeAfterDays = thresholds.get(row.account_id ?? '')
      const target = autoStatusFor(row, { now, closeAfterDays })
      if (target === 'closed') closed.push(row.id)
      else if (target === 'pending') pending.push(row.id)
    }

    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      scanned,
      pending: pending.length,
      closed: closed.length,
      thresholds: Object.fromEntries(thresholds),
    })
  }

  let closedChanged = 0
  let pendingChanged = 0
  try {
    closedChanged = await applyStatus(admin, closed, 'closed', 'auto_idle')
    pendingChanged = await applyStatus(admin, pending, 'pending', 'auto_window')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: message, scanned }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    scanned,
    pending: pendingChanged,
    closed: closedChanged,
  })
}
