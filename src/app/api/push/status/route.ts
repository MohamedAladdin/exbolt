// ============================================================
// /api/push/status — who on this team actually receives alerts?
//
// Admin+ only. Answers the question an operator asks after shipping a
// notification channel: «مين مشغّل ومين لا؟» — and it has to be exact, because a
// list that says "everyone is fine" while half the team has never enabled
// notifications is worse than no list at all.
//
// Three reads with the service-role client (RLS would answer only "my own rows"):
//   profiles                → the roster + roles
//   push_subscriptions      → registered devices per member
//   notification_preferences→ the per-user master switches
// The counting rules live in `lib/push/status.ts` and are unit-tested.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { buildPushStatus } from "@/lib/push/status";

export const dynamic = "force-dynamic";

export async function GET() {
  let ctx;
  try {
    // Members are readable by any member, but this endpoint aggregates other
    // people's device telemetry — that is an admin's view, not a colleague's.
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }

  const admin = supabaseAdmin();

  const [membersResult, subsResult, prefsResult] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, full_name, account_role")
      .eq("account_id", ctx.accountId),
    admin
      .from("push_subscriptions")
      .select("user_id, endpoint, last_seen_at")
      .eq("account_id", ctx.accountId),
    admin
      .from("notification_preferences")
      .select("user_id, push_enabled, in_app_alerts")
      .eq("account_id", ctx.accountId),
  ]);

  const failed = membersResult.error ?? subsResult.error ?? prefsResult.error;
  if (failed) {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  return NextResponse.json(
    buildPushStatus({
      members: (membersResult.data ?? []) as never,
      subscriptions: (subsResult.data ?? []) as never,
      preferences: (prefsResult.data ?? []) as never,
    }),
  );
}
