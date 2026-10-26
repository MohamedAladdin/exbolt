'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Search } from 'lucide-react';

import type { AccountRow } from '@/lib/admin/queries';
import { adminT } from '@/lib/admin/copy';
import { formatNumber, humanDays } from '@/lib/admin/format';
import { DataTable, EmptyRow, TD, TH, THead } from '@/components/admin/ui';
import {
  AccountStatusChip,
  SubStatusChip,
} from '@/components/admin/status-chips';

export function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const locale = useLocale();
  const t = adminT(locale);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [plan, setPlan] = useState('all');

  const plans = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((row) => row.planCode)
            .filter((code): code is string => Boolean(code))
        )
      ),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (plan !== 'all' && row.planCode !== plan) return false;
      if (!needle) return true;
      return [
        row.name,
        row.brandName,
        row.ownerEmail,
        row.ownerName,
        row.planCode,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, query, status, plan]);

  return (
    <div className="border-border bg-card rounded-xl border">
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="relative min-w-52 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute inset-y-0 start-2.5 my-auto size-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('accounts.search')}
            className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-foreground/30 h-8 w-full rounded-md border ps-8 pe-2 text-sm focus:outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="border-border bg-background text-foreground h-8 rounded-md border px-2 text-xs"
          aria-label={t('status')}
        >
          <option value="all">{t('all')}</option>
          <option value="active">{t('status.active')}</option>
          <option value="suspended">{t('status.suspended')}</option>
          <option value="archived">{t('status.archived')}</option>
          <option value="banned">{t('status.banned')}</option>
        </select>
        <select
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          className="border-border bg-background text-foreground h-8 rounded-md border px-2 text-xs"
          aria-label={t('col.plan')}
        >
          <option value="all">{t('all')}</option>
          {plans.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-xs">
          {t('accounts.count', { count: filtered.length })}
        </span>
      </div>

      <div className="p-4">
        <DataTable>
          <THead>
            <TH>{t('col.account')}</TH>
            <TH>{t('col.plan')}</TH>
            <TH>{t('status')}</TH>
            <TH className="text-end">{t('col.members')}</TH>
            <TH className="text-end">{t('col.messages30')}</TH>
            <TH className="text-end">{t('col.lastActivity')}</TH>
          </THead>
          <tbody>
            {filtered.length === 0 ? (
              <EmptyRow colSpan={6}>{t('accounts.empty')}</EmptyRow>
            ) : (
              filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-border/60 hover:bg-muted/40 border-b last:border-0"
                >
                  <TD>
                    <Link
                      href={`/admin/accounts/${row.id}`}
                      className="block min-w-0"
                    >
                      <span className="text-foreground block truncate font-medium hover:underline">
                        {row.brandName || row.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {row.ownerEmail ?? '—'}
                      </span>
                    </Link>
                  </TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-muted-foreground text-xs">
                        {row.planCode ?? t('plan.none')}
                      </span>
                      <SubStatusChip
                        status={row.subscriptionStatus}
                        locale={locale}
                      />
                    </div>
                  </TD>
                  <TD>
                    <AccountStatusChip status={row.status} locale={locale} />
                  </TD>
                  <TD className="text-end text-xs tabular-nums">
                    {formatNumber(row.members)}
                  </TD>
                  <TD className="text-end text-xs tabular-nums">
                    {formatNumber(row.messages30d)}
                  </TD>
                  <TD className="text-muted-foreground text-end text-xs">
                    {row.lastActivity ? humanDays(row.lastActivity) : '—'}
                  </TD>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </div>
    </div>
  );
}
