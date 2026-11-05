// ============================================================
// /api/push/devices — the devices list in Settings → الإشعارات.
//
//   GET    → this user's devices in this account (never anyone else's)
//   DELETE → { id } removes one device
//
// A device row is a capability: whoever holds the endpoint can send to that
// browser. RLS already restricts `push_subscriptions` to its owner, and the
// session is the only source of identity here — no user id is read from the body.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

export async function GET() {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { data, error } = await ctx.supabase
    .from("push_subscriptions")
    .select("id, locale, user_agent, created_at, last_seen_at, failures, last_error")
    .eq("user_id", ctx.userId)
    .eq("account_id", ctx.accountId)
    .order("last_seen_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  return NextResponse.json({ devices: data ?? [] });
}

export async function DELETE(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  // Scoped to this user in this account: a forged id from another tenant is a
  // no-op, not a deletion.
  const { error } = await ctx.supabase
    .from("push_subscriptions")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("account_id", ctx.accountId);

  if (error) {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
