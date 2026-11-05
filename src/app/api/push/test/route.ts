// ============================================================
// /api/push/test — «إرسال إشعار تجريبي»
//
// Sends nothing but the caller's own devices, and it goes through the real
// transport (`sendPush`), so a green result here proves: keys are loaded, the
// endpoint is reachable, the payload encrypts, and this browser is listening.
// A test that only wrote a DB row would prove none of that.
//
// Rate-limited to 5/min per user: the button is cheap to press, the push
// service is not a toy, and a stuck client must not turn into a loop.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { buildTestPayload, type PushLocale } from "@/lib/push/payload";
import { isPushConfigured, sendPush } from "@/lib/push/web-push";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RATE = { limit: 5, windowMs: 60_000 };

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(`push-test:${ctx.userId}`, RATE);
  if (!limit.success) return rateLimitResponse(limit);

  if (!isPushConfigured()) {
    return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
  }

  let locale: PushLocale = "ar";
  try {
    const body = (await request.json()) as { locale?: unknown } | null;
    locale = body?.locale === "en" ? "en" : "ar";
  } catch {
    // No body is fine: the default locale is Arabic.
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", ctx.userId)
    .eq("account_id", ctx.accountId);

  if (error) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  const subscriptions = (data ?? []) as SubscriptionRow[];
  if (subscriptions.length === 0) {
    // Not an error: this device simply has not been registered yet.
    return NextResponse.json({ error: "no_device", sent: 0 }, { status: 409 });
  }

  const content = buildTestPayload(locale);
  let sent = 0;
  let gone = 0;
  let failed = 0;
  const dead: string[] = [];

  for (const sub of subscriptions) {
    const result = await sendPush(sub, content, { urgency: "high" });
    if (result.outcome === "ok") {
      sent += 1;
      continue;
    }
    if (result.outcome === "gone") {
      gone += 1;
      dead.push(sub.id);
      continue;
    }
    failed += 1;
    await admin
      .from("push_subscriptions")
      .update({
        last_error: result.detail ?? result.outcome,
        failures: 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", sub.id);
  }

  // A 404/410 means the browser dropped the subscription: keep the row and every
  // future alert pays for it, so it goes now.
  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }

  return NextResponse.json({
    ok: sent > 0,
    sent,
    gone,
    failed,
    total: subscriptions.length,
  });
}
