'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { BellRing } from 'lucide-react';

import type { InvoiceRow } from '@/lib/admin/queries';
import { adminRequest } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import { formatDate, formatMoney } from '@/lib/admin/format';
import { DataTable, EmptyRow, TD, TH, THead } from '@/components/admin/ui';
import { InvoiceStatusChip } from '@/components/admin/status-chips';

export function BillingInvoices({ rows }: { rows: InvoiceRow[] }) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (invoiceId: string, body: Record<string, unknown>) => {
    setBusy(invoiceId);
    try {
      const result = await adminRequest<{ status?: string }>(
        '/api/admin/invoices',
        {
          ...body,
          invoiceId,
        }
      );
      if (result.status === 'dry_run') toast.warning(t('email.dryRun'));
      else if (result.status === 'failed') toast.error(t('email.failed'));
      else toast.success(t('done'));
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <DataTable>
      <THead>
        <TH>{t('invoices.number')}</TH>
        <TH>{t('col.account')}</TH>
        <TH>{t('status')}</TH>
        <TH className="text-end">{t('amount')}</TH>
        <TH className="text-end">{t('dueDate')}</TH>
        <TH className="text-end">{t('actions')}</TH>
      </THead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6}>{t('invoices.empty')}</EmptyRow>
        ) : (
          rows.map((invoice) => (
            <tr
              key={invoice.id}
              className="border-border/60 border-b last:border-0"
            >
              <TD>
                <span className="text-foreground font-mono text-[11px]">
                  {invoice.number}
                </span>
                <span className="text-muted-foreground block text-[11px]">
                  {formatDate(invoice.issueDate)}
                </span>
              </TD>
              <TD>
                <Link
                  href={`/admin/accounts/${invoice.accountId}`}
                  className="text-foreground text-sm hover:underline"
                >
                  {invoice.accountName ?? '—'}
                </Link>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {invoice.toEmail ?? '—'}
                </span>
              </TD>
              <TD>
                <InvoiceStatusChip status={invoice.status} locale={locale} />
                {invoice.remindersSent > 0 ? (
                  <span className="text-muted-foreground mt-0.5 block text-[11px]">
                    {t('invoices.reminders')}: {invoice.remindersSent}
                  </span>
                ) : null}
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
                    disabled={busy === invoice.id}
                    onClick={() => act(invoice.id, { action: 'send' })}
                    className="border-border text-foreground hover:bg-muted rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
                  >
                    {t('invoices.send')}
                  </button>
                  {invoice.status !== 'paid' ? (
                    <button
                      type="button"
                      disabled={busy === invoice.id}
                      onClick={() =>
                        act(invoice.id, { action: 'update', status: 'paid' })
                      }
                      className="border-border hover:bg-muted rounded-md border px-2 py-1 text-[11px] text-emerald-600 disabled:opacity-50 dark:text-emerald-400"
                    >
                      {t('invoices.markPaid')}
                    </button>
                  ) : null}
                </div>
              </TD>
            </tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

export function ReminderRunner({
  days,
  grace,
}: {
  days: number;
  grace: number;
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    sent: number;
    dryRun: number;
    failed: number;
  } | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const data = await adminRequest<{
        sent: number;
        dryRun: number;
        failed: number;
      }>('/api/admin/invoices', { action: 'remind' });
      setResult(data);
      if (data.failed > 0) toast.error(t('email.failed'));
      else if (data.dryRun > 0) toast.warning(t('email.dryRun'));
      else toast.success(t('done'));
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground max-w-xl text-xs">
        {t('billing.reminders.desc', { days, grace })}
      </p>
      <div className="flex items-center gap-2">
        {result ? (
          <span className="text-muted-foreground text-xs">
            {t('billing.reminders.result', result)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="bg-foreground text-background inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          <BellRing className="size-3.5" />
          {busy ? t('working') : t('billing.reminders.run')}
        </button>
      </div>
    </div>
  );
}
