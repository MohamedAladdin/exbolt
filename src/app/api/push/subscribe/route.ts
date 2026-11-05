// ============================================================
// /api/push/subscribe — register this device, or drop it.
//
//   POST   { endpoint, keys: { p256dh, auth }, locale }  → upsert
//   DELETE { endpoint }            → remove that device
//   DELETE { all: true }           → remove every device for the caller
//
// Three guards that matter more than the happy path:
//
//   1. The endpoint is attacker-supplied and the sender POSTs to it, so it
//      must pass the push-service allowlist (`lib/push/endpoint.ts`) before
//      it is stored — otherwise the row is an SSRF primitive.
//   2. `user_id` and `account_id` come from the session, never from the
//      body, and RLS re-checks both.
//   3. A user can register at most `MAX_DEVICES_PER_USER` devices; without a
//      ceiling a broken client loop can fill the table and every future
//      alert pays for it.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { normalizeSubscription } from "@/lib/push/endpoint";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Laptop + phone + tablet + a spare browser: ten is already generous. */
export const MAX_DEVICES_PER_USER = 10;

const RATE = { limit: 10, windowMs: 60_000 };

type Locale = "ar" | "en";

function normalizeLocale(value: unknown): Locale {
  return value === "en" ? "en" : "ar";
}

/** Best-effort label for the devices list. Never trusted, only displayed. */
function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;
  return userAgent.slice(0, 200);
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(`push-subscribe:${ctx.userId}`, RATE);
  if (!limit.success) return rateLimitResponse(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const raw = body as { subscription?: unknown; locale?: unknown } | null;
  // Accept both the flat PushSubscription JSON and `{ subscription, locale }`
  // so the client can send either shape without a second round trip.
  const candidate = raw && typeof raw === "object" && "subscription" in raw ? raw.subscription : raw;
  const normalized = normalizeSubscription(candidate);
  if (!normalized) {
    return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  }

  const locale = normalizeLocale((raw as { locale?: unknown } | null)?.locale);

  const { count, error: countErr } = await ctx.supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId);

  if (countErr) {
    return NextResponse.json({ error: "count_failed" }, { status: 500 });
  }

  // An existing row for this endpoint is an update, not a new device — check
  // before rejecting on the cap, or a re-subscribe on a full account fails.
  const { data: existing, error: existingErr } = await ctx.supabase
    .from("push_subscriptions")
    .select("id")
    .eq("account_id", ctx.accountId)
    .eq("endpoint", normalized.endpoint)
    .maybeSingle();

  if (existingErr) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  if (!existing && (count ?? 0) >= MAX_DEVICES_PER_USER) {
    return NextResponse.json(
      { error: "too_many_devices", max: MAX_DEVICES_PER_USER },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const row = {
    account_id: ctx.accountId,
    user_id: ctx.userId,
    endpoint: normalized.endpoint,
    p256dh: normalized.p256dh,
    auth: normalized.auth,
    locale,
    user_agent: deviceLabel(request.headers.get("user-agent")),
    last_seen_at: now,
    failures: 0,
    last_error: null,
  };

  const { error: upsertErr } = existing
    ? await ctx.supabase.from("push_subscriptions").update(row).eq("id", existing.id)
    : await ctx.supabase.from("push_subscriptions").insert(row);

  if (upsertErr) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, locale });
}

export async function DELETE(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(`push-unsubscribe:${ctx.userId}`, RATE);
  if (!limit.success) return rateLimitResponse(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const raw = body as { endpoint?: unknown; all?: unknown } | null;

  if (raw?.all === true) {
    // RLS restricts the delete to the caller's own rows; the eq() is belt and braces.
    const { error } = await ctx.supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", ctx.userId);
    if (error) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (typeof raw?.endpoint !== "string" || !raw.endpoint) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { error } = await ctx.supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", ctx.userId)
    .eq("endpoint", raw.endpoint);

  if (error) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
