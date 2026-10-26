'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Plus, X } from 'lucide-react';

import type { InvoiceRow } from '@/lib/admin/queries';
import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import { formatDate, formatMoney } from '@/lib/admin/format';
import { invoiceTotals, type LineItem } from '@/lib/admin/invoice';
import { DataTable, EmptyRow, TD, TH, THead } from '@/components/admin/ui';
import { InvoiceStatusChip } from '@/components/admin/status-chips';

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

export function InvoicePanel({
  accountId,
  invoices,
  defaultEmail,
  defaultName,
  currency,
  planCode,
}: {
  accountId: string;
  invoices: InvoiceRow[];
  defaultEmail: string;
  defaultName: string;
  currency: string;
  planCode: string | null;
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<LineItem[]>([
    { description: '', quantity: 1, unit_price: 0 },
  ]);
  const [tax, setTax] = useState('0');
  const [due, setDue] = useState(() =>
    new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  );
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [toEmail, setToEmail] = useState(defaultEmail);

  const totals = useMemo(
    () => invoiceTotals(lines, Number(tax) || 0),
    [lines, tax]
  );

  const setLine = (index: number, patch: Partial<LineItem>) => {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  };

  const create = async () => {
    setBusy(true);
    try {
      await adminPatch('/api/admin/invoices', {
        action: 'create',
        accountId,
        lineItems: lines.filter(
          (line) => line.description.trim() && line.unit_price > 0
        ),
        tax: Number(tax) || 0,
        currency,
        dueDate: due,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        notes: notes || null,
        toEmail: toEmail || null,
        toName: defaultName,
        planCode,
      });
      toast.success(t('done'));
      setOpen(false);
      setLines([{ description: '', quantity: 1, unit_price: 0 }]);
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  const act = async (body: Record<string, unknown>, message?: string) => {
    setBusy(true);
    try {
      const result = await adminPatch<{ status?: string }>(
        '/api/admin/invoices',
        body
      );
      if (result.status === 'dry_run') toast.warning(t('email.dryRun'));
      else if (result.status === 'failed') toast.error(t('email.failed'));
      else toast.success(message ?? t('done'));
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-border bg-card rounded-xl border">
      <header className="border-border flex items-start justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <FileText className="text-muted-foreground size-4" />
          {t('invoices.title')}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="border-border text-foreground hover:bg-muted inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium"
        >
          <Plus className="size-3.5" />
          {t('invoices.create')}
        </button>
      </header>

      {open ? (
        <div className="border-border flex flex-col gap-2 border-b p-4">
          <div className="flex flex-col gap-1">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 items-center gap-1">
                <input
                  value={line.description}
                  onChange={(event) =>
                    setLine(index, { description: event.target.value })
                  }
                  placeholder={t('invoice.new.description')}
                  className={`${inputClass} col-span-6`}
                />
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(event) =>
                    setLine(index, { quantity: Number(event.target.value) })
                  }
                  placeholder={t('invoice.new.qty')}
                  className={`${inputClass} col-span-2`}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unit_price}
                  onChange={(event) =>
                    setLine(index, { unit_price: Number(event.target.value) })
                  }
                  placeholder={t('invoice.new.unitPrice')}
                  className={`${inputClass} col-span-3`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setLines((current) => current.filter((_, i) => i !== index))
                  }
                  className="text-muted-foreground hover:bg-muted hover:text-foreground col-span-1 flex h-8 items-center justify-center rounded-md"
                  aria-label={t('cancel')}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { description: '', quantity: 1, unit_price: 0 },
                ])
              }
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"
            >
              <Plus className="size-3" />
              {t('invoice.new.addLine')}
            </button>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {t('invoice.new.tax')}
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                className={`${inputClass} w-24`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {t('dueDate')}
              </span>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className={`${inputClass} w-40`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {t('invoice.new.periodStart')}
              </span>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className={`${inputClass} w-40`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {t('invoice.new.periodEnd')}
              </span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className={`${inputClass} w-40`}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {t('invoice.new.toEmail')}
              </span>
              <input
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                className={inputClass}
                type="email"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
              {t('invoice.new.notes')}
            </span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </label>

          <div className="border-border flex items-center justify-between gap-3 border-t pt-2">
            <span className="text-muted-foreground text-sm">
              {t('invoice.new.total')}:{' '}
              <strong className="text-foreground tabular-nums">
                {formatMoney(totals.total, currency)}
              </strong>
            </span>
            <button
              type="button"
              onClick={create}
              disabled={busy || totals.total <= 0}
              className="bg-foreground text-background inline-flex h-8 items-center rounded-md px-3 text-xs font-medium hover:opacity-90 disabled:opacity-40"
            >
              {busy ? t('working') : t('invoice.new.create')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="p-4">
        <DataTable>
          <THead>
            <TH>{t('invoices.number')}</TH>
            <TH>{t('status')}</TH>
            <TH className="text-end">{t('amount')}</TH>
            <TH className="text-end">{t('dueDate')}</TH>
            <TH className="text-end">{t('actions')}</TH>
          </THead>
          <tbody>
            {invoices.length === 0 ? (
              <EmptyRow colSpan={5}>{t('invoices.empty')}</EmptyRow>
            ) : (
              invoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="border-border/60 border-b last:border-0"
                >
                  <TD>
                    <span className="text-foreground font-mono text-xs">
                      {invoice.number}
                    </span>
                  </TD>
                  <TD>
                    <InvoiceStatusChip
                      status={invoice.status}
                      locale={locale}
                    />
                  </TD>
                  <TD className="text-end text-xs tabular-nums">
                    {formatMoney(invoice.amount, invoice.currency)}
                  </TD>
                  <TD className="text-muted-foreground text-end text-xs">
                    {formatDate(invoice.dueDate)}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act({ action: 'send', invoiceId: invoice.id })
                        }
                        className="border-border text-foreground hover:bg-muted rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
                      >
                        {t('invoices.send')}
                      </button>
                      {invoice.status !== 'paid' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            act({
                              action: 'update',
                              invoiceId: invoice.id,
                              status: 'paid',
                            })
                          }
                          className="border-border hover:bg-muted rounded-md border px-2 py-1 text-[11px] text-emerald-600 disabled:opacity-50 dark:text-emerald-400"
                        >
                          {t('invoices.markPaid')}
                        </button>
                      ) : null}
                      {invoice.status !== 'void' &&
                      invoice.status !== 'paid' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            act({
                              action: 'update',
                              invoiceId: invoice.id,
                              status: 'void',
                            })
                          }
                          className="border-border text-muted-foreground hover:bg-muted rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
                        >
                          {t('invoices.void')}
                        </button>
                      ) : null}
                    </div>
                  </TD>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </div>
    </section>
  );
}
