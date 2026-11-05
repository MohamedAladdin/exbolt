/**
 * The sender: claim outbox rows, re-check the world, push, record what happened.
 *
 * This is called from three places and behaves identically in all of them:
 *   * `after()` in the Meta webhook — the fast path, right after the message lands;
 *   * the sweeper cron — retries, reconciliation and anything the fast path missed;
 *   * (P4) the claim RPC's caller, for assignment alerts.
 *
 * Two rules that are easy to get wrong and expensive when wrong:
 *
 *   * **Claim is exclusive.** Two workers (webhook + sweeper, or two webhook
 *     invocations) must never send the same row twice. The UPDATE is the lock:
 *     `WHERE id = ? AND (claimed_at IS NULL OR claimed_at < now() - 2 min)`.
 *     A crash between claim and send is retried after the 2-minute window, which
 *     is why the claim ages instead of being permanent.
 *
 *   * **Every gate is re-evaluated at SEND.** Ownership, the type switch, the
 *     channel switch and quiet hours can all change between the event and the
 *     send. A row enqueued for the previous assignee must be dropped, not
 *     delivered to someone who no longer owns the thread.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import type { PushLocale } from "@/lib/push/payload";
import { isQuietNow, renderPush, type PushKind, type PushPreview } from "@/lib/push/render";
import { isPushConfigured, sendPush } from "@/lib/push/web-push";

/** A claim older than this belongs to a worker that died mid-send. */
export const CLAIM_STALE_MS = 2 * 60_000;

/** Attempts 1..4 wait 1, 5, 15, 60 minutes; the 5th failure gives up. */
export const BACKOFF_MINUTES = [1, 5, 15, 60] as const;
export const MAX_ATTEMPTS = 5;

/** Per drain call. The sweeper runs every minute; the webhook drains 12 rows. */
export const DEFAULT_DRAIN_LIMIT = 25;

export interface OutboxRow {
  id: string;
  account_id: string;
  user_id: string;
  conversation_id: string | null;
  kind: PushKind;
  contact_name: string | null;
  preview: string | null;
  url: string | null;
  attempts: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: PushLocale;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  skipped: number;
  retried: number;
  gone: number;
  /** Rows the claim lost to another worker — not an error. */
  lost_race: number;
}

const EMPTY: DrainResult = {
  claimed: 0,
  sent: 0,
  skipped: 0,
  retried: 0,
  gone: 0,
  lost_race: 0,
};

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function backoffIso(attempts: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? 60;
  return nowIso(minutes * 60_000);
}

async function skip(admin: SupabaseClient, id: string, reason: string): Promise<void> {
  await admin
    .from("push_outbox")
    .update({ skipped_at: nowIso(), skip_reason: reason, last_error: null })
    .eq("id", id);
}

/**
 * Draft the candidate list. Not filtered by conversation in SQL when the caller
 * passes an id? It is — the webhook only cares about its own thread, and a
 * filtered scan uses `idx_push_outbox_conversation`.
 */
async function candidates(
  admin: SupabaseClient,
  opts: { conversationId?: string; limit: number },
): Promise<OutboxRow[]> {
  const staleBefore = nowIso(-CLAIM_STALE_MS);
  let query = admin
    .from("push_outbox")
    .select("id, account_id, user_id, conversation_id, kind, contact_name, preview, url, attempts")
    .is("sent_at", null)
    .is("skipped_at", null)
    .lte("next_attempt_at", nowIso())
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .order("severity", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(opts.limit);

  if (opts.conversationId) query = query.eq("conversation_id", opts.conversationId);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as OutboxRow[];
}

/** Claim one row. Returns false when another worker got there first. */
async function claim(admin: SupabaseClient, row: OutboxRow): Promise<boolean> {
  const staleBefore = nowIso(-CLAIM_STALE_MS);
  const { data, error } = await admin
    .from("push_outbox")
    .update({ claimed_at: nowIso(), attempts: row.attempts + 1 })
    .eq("id", row.id)
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .select("id");

  return !error && Array.isArray(data) && data.length === 1;
}

interface SendContext {
  preview: PushPreview;
  subscriptions: SubscriptionRow[];
}

/**
 * Everything the send needs about the recipient, in two queries.
 * Returns a skip reason instead when the row must not be delivered.
 */
async function loadContext(
  admin: SupabaseClient,
  row: OutboxRow,
): Promise<SendContext | { skip: string }> {
  // 1. Ownership may have moved while the row waited.
  if (row.conversation_id) {
    const { data: conv } = await admin
      .from("conversations")
      .select("assigned_agent_id")
      .eq("id", row.conversation_id)
      .maybeSingle<{ assigned_agent_id: string | null }>();
    if (conv?.assigned_agent_id && conv.assigned_agent_id !== row.user_id) {
      return { skip: "reassigned" };
    }
  }

  // 2. Preferences — channel master, type switch and privacy level.
  const { data: prefs } = await admin
    .from("notification_preferences")
    .select("push_enabled, push_preview, quiet_from, quiet_to")
    .eq("user_id", row.user_id)
    .maybeSingle<{
      push_enabled: boolean;
      push_preview: PushPreview;
      quiet_from: string | null;
      quiet_to: string | null;
    }>();

  if (prefs && !prefs.push_enabled) return { skip: "preferences" };

  const { data: allowed } = await admin.rpc("push_enabled_for", {
    p_user: row.user_id,
    p_kind: row.kind,
  });
  if (allowed === false) return { skip: "preferences" };

  if (prefs?.quiet_from && prefs.quiet_to) {
    const { data: account } = await admin
      .from("accounts")
      .select("business_timezone")
      .eq("id", row.account_id)
      .maybeSingle<{ business_timezone: string | null }>();
    const tz = account?.business_timezone || "Africa/Cairo";
    if (isQuietNow(prefs.quiet_from, prefs.quiet_to, tz)) return { skip: "quiet_hours" };
  }

  // 3. Devices. The sender only talks to this user's devices in this account.
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, locale")
    .eq("user_id", row.user_id)
    .eq("account_id", row.account_id);

  const subscriptions = (subs ?? []) as SubscriptionRow[];
  if (subscriptions.length === 0) return { skip: "no_device" };

  return { preview: prefs?.push_preview ?? "name", subscriptions };
}

/**
 * Send (or reschedule) one claimed row.
 * Returns what happened, so the drain can count it.
 */
async function deliver(
  admin: SupabaseClient,
  row: OutboxRow,
): Promise<"sent" | "retried" | "skipped" | "gone"> {
  const ctx = await loadContext(admin, row);
  if ("skip" in ctx) {
    await skip(admin, row.id, ctx.skip);
    return "skipped";
  }

  const attempts = row.attempts + 1;
  const deadDevices: string[] = [];
  const errors: string[] = [];
  let accepted = 0;
  let retryable = 0;

  for (const sub of ctx.subscriptions) {
    const content = renderPush(
      {
        kind: row.kind,
        contactName: row.contact_name,
        preview: row.preview,
        url: row.url,
        tag: row.conversation_id ? `conv:${row.conversation_id}` : `outbox:${row.id}`,
      },
      sub.locale ?? "ar",
      ctx.preview,
    );

    const result = await sendPush(sub, content, {
      urgency: "high",
      topic: row.conversation_id ? `obx-${row.conversation_id}` : undefined,
    });

    if (result.outcome === "ok") {
      accepted += 1;
      continue;
    }
    if (result.outcome === "gone") {
      deadDevices.push(sub.id);
      continue;
    }
    if (result.outcome === "retry") {
      retryable += 1;
      errors.push(result.detail ?? "retry");
      continue;
    }
    errors.push(result.detail ?? result.outcome);
  }

  // A 404/410 is permanent: the browser dropped the subscription, and keeping
  // the row charges every future alert for a device that will never answer.
  if (deadDevices.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", deadDevices);
  }

  if (accepted > 0) {
    await admin
      .from("push_outbox")
      .update({ sent_at: nowIso(), last_error: errors[0] ?? null, claimed_at: null })
      .eq("id", row.id);
    return "sent";
  }

  if (retryable > 0 && attempts < MAX_ATTEMPTS) {
    await admin
      .from("push_outbox")
      .update({
        claimed_at: null,
        next_attempt_at: backoffIso(attempts),
        last_error: errors[0] ?? "retry",
      })
      .eq("id", row.id);
    return "retried";
  }

  if (retryable === 0 && deadDevices.length === ctx.subscriptions.length) {
    await skip(admin, row.id, "no_device");
    return "gone";
  }

  await admin
    .from("push_outbox")
    .update({
      skipped_at: nowIso(),
      skip_reason: attempts >= MAX_ATTEMPTS ? "gave_up" : "send_failed",
      last_error: errors[0] ?? "send_failed",
    })
    .eq("id", row.id);
  return "skipped";
}

/**
 * Drain pending rows. Never throws: callers are a webhook's `after()` block and
 * a cron tick, neither of which may fail because a phone was offline.
 */
export async function drainPushOutbox(
  opts: { conversationId?: string; limit?: number } = {},
): Promise<DrainResult> {
  if (!isPushConfigured()) return { ...EMPTY };

  const admin = supabaseAdmin();
  const result: DrainResult = { ...EMPTY };

  try {
    const rows = await candidates(admin, {
      conversationId: opts.conversationId,
      limit: opts.limit ?? DEFAULT_DRAIN_LIMIT,
    });

    for (const row of rows) {
      if (!(await claim(admin, row))) {
        result.lost_race += 1;
        continue;
      }
      result.claimed += 1;

      try {
        const outcome = await deliver(admin, row);
        if (outcome === "sent") result.sent += 1;
        else if (outcome === "retried") result.retried += 1;
        else if (outcome === "gone") result.gone += 1;
        else result.skipped += 1;
      } catch (err) {
        // One bad row must not stop the rest of the queue.
        console.error("[push] drain row failed:", row.id, err);
        await admin
          .from("push_outbox")
          .update({
            claimed_at: null,
            next_attempt_at: backoffIso(row.attempts + 1),
            last_error: err instanceof Error ? err.message : "unknown",
          })
          .eq("id", row.id);
        result.retried += 1;
      }
    }
  } catch (err) {
    console.error("[push] drain failed:", err);
  }

  return result;
}

/** The webhook's fast path: only the thread it just wrote to. */
export async function drainPushForConversation(conversationId: string): Promise<DrainResult> {
  return drainPushOutbox({ conversationId, limit: 12 });
}
