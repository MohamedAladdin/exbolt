// ============================================================
// /api/account/invoices
//
//   GET — the signed-in account's invoices, newest first.
//
// `invoices` is an operator table: RLS is ON with no policies, so a
// tenant session can read nothing directly (by design — the admin panel
// writes these rows). Reads therefore go through the service-role client
// and are filtered by `account_id` taken from the session, never from a
// query parameter. Admin+ only: the rows carry amounts, payment
// references and the payer's name.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { adminDb } from "@/lib/admin/db";

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const { data, error } = await adminDb()
      .from("invoices")
      .select(
        "id, number, status, currency, amount, tax, issue_date, due_date, " +
          "period_start, period_end, plan_code, paid_at, sent_at, " +
          "payment_reference, payment_payer, line_items, notes",
      )
      .eq("account_id", ctx.accountId)
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[account/invoices] read failed:", error.message);
      return NextResponse.json({ error: "read_failed" }, { status: 500 });
    }

    // Only what the billing screen needs — `notes` and `line_items` are
    // included because the download renders them, not because the list
    // shows them.
    return NextResponse.json({ invoices: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
