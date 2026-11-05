// ============================================================
// /api/conversations/claim — "this thread is mine now"
//
// The inbox calls it when a thread is opened (reason `open`) and the send path
// calls `claim_conversation` directly after a successful reply. Both go through
// ONE SQL function so the rules (role gate, auto-claim switches, never steal)
// cannot drift between the two paths.
//
// A no-op is a success: the thread is already yours, or the account turned
// auto-claim off, or a colleague owns it. The inbox must not show an error for
// "you read a thread that belongs to someone else".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Opening threads is a fast, repeated action; the cap is a runaway guard only. */
const RATE = { limit: 120, windowMs: 60_000 };

const REASONS = new Set(["open", "reply", "manual"]);

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(`conv-claim:${ctx.userId}`, RATE);
  if (!limit.success) return rateLimitResponse(limit);

  let body: { conversation_id?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
  const reason = typeof body.reason === "string" && REASONS.has(body.reason) ? body.reason : "open";

  if (!conversationId) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // The function re-checks membership, role and ownership; a forged id from
  // another tenant simply does nothing.
  const { error } = await ctx.supabase.rpc("claim_conversation", {
    p_conversation: conversationId,
    p_reason: reason,
  });

  if (error) {
    return NextResponse.json({ error: "claim_failed", detail: error.message }, { status: 500 });
  }

  const { data } = await ctx.supabase
    .from("conversations")
    .select("id, assigned_agent_id, claim_reason, first_opened_by")
    .eq("id", conversationId)
    .maybeSingle();

  return NextResponse.json({ ok: true, conversation: data ?? null });
}
