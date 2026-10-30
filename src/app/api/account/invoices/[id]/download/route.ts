// ============================================================
// /api/account/invoices/[id]/download
//
//   GET — one invoice as a self-contained, print-ready HTML file
//         (`Content-Disposition: attachment`).
//
// Authorisation is the account, not the id: the row is fetched with
// `.eq('account_id', ctx.accountId)` on the service-role client, so an id
// from another tenant answers 404 exactly like a missing one. Why HTML and
// not PDF: the app image ships no headless browser and no PDF engine, and a
// hand-rolled PDF with an embedded Arabic font would render disconnected,
// reversed glyphs. A single-file A4 document that prints to PDF from the
// browser is honest, offline-readable and identical on every device.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { adminDb } from "@/lib/admin/db";
import { VENDOR_NAME, VENDOR_URL } from "@/lib/branding";
import { renderInvoiceHtml } from "@/lib/billing/invoice-document";
import type { InvoiceLineItem } from "@/lib/billing/invoice-document";

/** Shape of the row we render. `invoices` predates the generated DB types,
 *  so the typed client answers `GenericStringError` for every column here —
 *  assert the shape once instead of sprinkling `any` through the renderer. */
interface InvoiceRecord {
  id: string;
  number: string;
  status: string;
  currency: string;
  amount: string | number;
  tax: string | number | null;
  issue_date: string;
  due_date: string | null;
  paid_at: string | null;
  line_items: InvoiceLineItem[] | null;
  notes: string | null;
  to_name: string | null;
  to_email: string | null;
  payment_reference: string | null;
  payment_payer: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    // A malformed id is a 404, not a Postgres cast error on the wire.
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const db = adminDb();
    const { data: invoiceRaw, error } = await db
      .from("invoices")
      .select(
        "id, number, status, currency, amount, tax, issue_date, due_date, " +
          "paid_at, line_items, notes, to_name, to_email, " +
          "payment_reference, payment_payer",
      )
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    const invoice = invoiceRaw as unknown as InvoiceRecord | null;

    if (error) {
      console.error("[account/invoices/download] read failed:", error.message);
      return NextResponse.json({ error: "read_failed" }, { status: 500 });
    }
    if (!invoice) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const { data: account } = await db
      .from("accounts")
      .select("name, brand_name")
      .eq("id", ctx.accountId)
      .maybeSingle();

    const html = renderInvoiceHtml({
      number: String(invoice.number),
      status: String(invoice.status),
      issueDate: String(invoice.issue_date),
      dueDate: invoice.due_date,
      paidAt: invoice.paid_at,
      currency: String(invoice.currency ?? "USD"),
      amount: invoice.amount,
      tax: invoice.tax,
      lineItems: (invoice.line_items ?? []) as InvoiceLineItem[],
      notes: invoice.notes,
      toName: invoice.to_name,
      toEmail: invoice.to_email,
      // The invoice's own "billed to" name wins: an account brand string
      // ("Hemocure_CRM") is an internal label, not how a payer is addressed.
      accountName:
        invoice.to_name ||
        account?.brand_name ||
        account?.name ||
        "",
      vendorName: VENDOR_NAME,
      vendorUrl: VENDOR_URL,
      paymentReference: invoice.payment_reference,
      paymentPayer: invoice.payment_payer,
    });

    const filename = `${String(invoice.number).replace(/[^A-Za-z0-9-]/g, "")}.html`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        // A downloaded document must never be framed or sniffed.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
