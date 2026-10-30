import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  formatMoney,
  renderInvoiceHtml,
  type InvoiceDocumentInput,
} from "./invoice-document";

const BASE: InvoiceDocumentInput = {
  number: "EXB-2026-0001",
  status: "paid",
  issueDate: "2026-10-24",
  dueDate: "2026-10-24",
  paidAt: "2026-10-24T18:13:57Z",
  currency: "USD",
  amount: 129,
  tax: 0,
  lineItems: [
    { description: "Hemocure — GROWTH monthly subscription", quantity: 1, unit_price: 129 },
  ],
  notes: null,
  toName: "3amer",
  toEmail: "billing@hemocure.example",
  accountName: "3amer",
  vendorName: "ExCal.uk",
  vendorUrl: "https://excal.uk",
  paymentReference: "461770911431786496",
  paymentPayer: "يعقوب قمر الدين دبيازة",
};

describe("renderInvoiceHtml", () => {
  it("prints the number, total and the payment reference", () => {
    const html = renderInvoiceHtml(BASE);
    expect(html).toContain("EXB-2026-0001");
    expect(html).toContain("$129.00");
    expect(html).toContain("461770911431786496");
    expect(html).toContain("يعقوب قمر الدين دبيازة");
    // Paid invoices carry a receipt block, drafts must not.
    expect(html).toContain("تم السداد");
  });

  it("omits the receipt block for an unpaid invoice", () => {
    const html = renderInvoiceHtml({ ...BASE, status: "sent", paidAt: null });
    expect(html).not.toContain("تم السداد");
    expect(html).toContain("مرسلة");
  });

  it("escapes every user-controlled field", () => {
    const html = renderInvoiceHtml({
      ...BASE,
      accountName: '<script>alert("x")</script>',
      notes: "5 > 3 & 2 < 4",
      lineItems: [{ description: "<b>bold</b>", quantity: 1, unit_price: 10 }],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("5 &gt; 3 &amp; 2 &lt; 4");
  });

  it("renders one table row per line item with the line total", () => {
    const html = renderInvoiceHtml({
      ...BASE,
      lineItems: [
        { description: "Seats", quantity: 3, unit_price: 12.5 },
        { description: "Setup", quantity: 1, unit_price: 50 },
      ],
    });
    expect((html.match(/<tr>\s*<td class="desc">/g) ?? []).length).toBe(2);
    expect(html).toContain("37.50");
  });
});

describe("formatting helpers", () => {
  it("formats money per currency", () => {
    expect(formatMoney(129, "USD")).toBe("$129.00");
    expect(formatMoney("129.5", "EGP")).toBe("129.50 ج.م");
    expect(formatMoney("oops", "USD")).toBe("$0.00");
  });

  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});
