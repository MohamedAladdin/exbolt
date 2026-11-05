// ============================================================
// /api/push/preferences — the switches behind Settings → الإشعارات
//
//   GET   → { preferences, is_default }
//   PATCH → partial update, returns the saved row
//
// A missing row is not an error: the defaults are the product's opinion, so GET
// answers them with `is_default: true` and the first PATCH creates the row. That
// keeps "what does a brand-new employee get?" in one place (`DEFAULT_PREFERENCES`).
//
// `account_id` and `user_id` come from the session. RLS re-checks the user, so a
// forged body cannot write someone else's preferences.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  normalizePreferencePatch,
  preferencesFromRow,
} from "@/lib/push/preferences";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RATE = { limit: 60, windowMs: 60_000 };

export async function GET() {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { data, error } = await ctx.supabase
    .from("notification_preferences")
    .select(
      "in_app_alerts, push_enabled, customer_message, conversation_assigned, ai_handoff, report_alert, push_preview, quiet_from, quiet_to",
    )
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  return NextResponse.json({
    preferences: preferencesFromRow(data as Record<string, unknown> | null),
    is_default: !data,
  });
}

export async function PATCH(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(`push-preferences:${ctx.userId}`, RATE);
  if (!limit.success) return rateLimitResponse(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { patch, invalid } = normalizePreferencePatch(body);
  if (invalid.length > 0) {
    return NextResponse.json({ error: "invalid_fields", invalid }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("notification_preferences")
    .upsert(
      { user_id: ctx.userId, account_id: ctx.accountId, ...patch },
      { onConflict: "user_id" },
    )
    .select(
      "in_app_alerts, push_enabled, customer_message, conversation_assigned, ai_handoff, report_alert, push_preview, quiet_from, quiet_to",
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({
    preferences: preferencesFromRow((data as Record<string, unknown> | null) ?? { ...patch }),
    is_default: false,
  });
}
