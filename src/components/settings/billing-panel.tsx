"use client";

// ============================================================
// BillingPanel — Settings → Billing
//
// The tenant's own view of what it has been invoiced: number, issue
// date, amount, status and — the part the operator asked for — the
// **payment date**, the provider's order id, and a downloadable copy
// of each invoice.
//
// `invoices` is an operator table with RLS on and no policies, so this
// panel never touches Supabase directly: it reads
// `/api/account/invoices` (admin+, account-scoped server-side) and
// downloads from `/api/account/invoices/[id]/download`. Admin+ only,
// for the same reason the API is: amounts and payment references are
// not agent-facing data.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, Loader2, Receipt, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RequireRole } from "@/components/auth/require-role";
import { SettingsPanelHead } from "./settings-panel-head";
import { cn } from "@/lib/utils";

interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  currency: string;
  amount: string | number;
  issue_date: string;
  due_date: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  payment_payer: string | null;
}

const STATUS_TONE: Record<string, string> = {
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  sent: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  overdue: "border-red-500/40 bg-red-500/10 text-red-500",
  draft: "border-border bg-muted text-muted-foreground",
  void: "border-border bg-muted text-muted-foreground line-through",
};

export function BillingPanel() {
  const t = useTranslations("Settings.billing");
  const locale = useLocale();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/account/invoices", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { invoices?: InvoiceRow[] };
      setRows(body.invoices ?? []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Africa/Cairo",
      }),
    [locale],
  );

  const dateTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Cairo",
      }),
    [locale],
  );

  const money = (value: string | number, currency: string) =>
    new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(Number(value) || 0);

  const safeDate = (value: string | null) => {
    if (!value) return "—";
    const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
    return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
  };

  return (
    <div>
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <RequireRole
        min="admin"
        fallback={
          <Card>
            <CardContent className="text-muted-foreground p-8 text-center text-sm">
              {t("adminOnly")}
            </CardContent>
          </Card>
        }
      >
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : failed ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <TriangleAlert className="text-muted-foreground size-6" />
              <p className="text-sm">{t("loadFailed")}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t("retry")}
              </Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Receipt className="text-muted-foreground size-7" />
              <p className="text-sm font-medium">{t("empty")}</p>
              <p className="text-muted-foreground text-xs">{t("emptyHint")}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <Card key={row.id}>
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {row.number}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px]",
                          STATUS_TONE[row.status] ??
                            "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {(["draft", "sent", "paid", "overdue", "void"].includes(
                          row.status,
                        )
                          ? t(`statuses.${row.status}`)
                          : row.status)}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {t("issued")}: {safeDate(row.issue_date)}
                      {row.paid_at
                        ? ` · ${t("paidAt")}: ${dateTimeFmt.format(new Date(row.paid_at))}`
                        : ""}
                    </div>
                    {row.payment_reference ? (
                      <div className="text-muted-foreground text-xs">
                        {t("paymentRef")}:{" "}
                        <span className="font-mono">{row.payment_reference}</span>
                        {row.payment_payer ? ` · ${row.payment_payer}` : ""}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                    <span className="text-base font-semibold tabular-nums">
                      {money(row.amount, row.currency)}
                    </span>
                    <a
                      href={`/api/account/invoices/${row.id}/download`}
                      download
                      className="border-border hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors"
                    >
                      <Download className="size-4" />
                      {t("download")}
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </RequireRole>
    </div>
  );
}
