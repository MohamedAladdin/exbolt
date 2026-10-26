import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import { ArrowUpRight, CircleAlert } from 'lucide-react';

import { getOverview } from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import { formatMoney, humanDays } from '@/lib/admin/format';
import {
  AdminCard,
  DataTable,
  EmptyRow,
  Stat,
  TD,
  TH,
  THead,
} from '@/components/admin/ui';
import {
  AccountStatusChip,
  SubStatusChip,
} from '@/components/admin/status-chips';
import { RegistrationToggle } from '@/components/admin/registration-toggle';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  await guardAdminPage();
  const locale = await getLocale();
  const t = adminT(locale);
  const overview = await getOverview();

  const attention: { key: string; label: string; tone: 'warn' | 'bad' }[] = [];
  if (overview.subscriptions.pastDue > 0) {
    attention.push({
      key: 'pastDue',
      label: t('attention.pastDue', { count: overview.subscriptions.pastDue }),
      tone: 'warn',
    });
  }
  if (overview.invoices.overdue > 0) {
    attention.push({
      key: 'overdue',
      label: t('attention.overdue', {
        count: overview.invoices.overdue,
        amount: formatMoney(overview.invoices.overdueAmount),
      }),
      tone: 'bad',
    });
  }
  if (overview.trialsEndingSoon.length > 0) {
    attention.push({
      key: 'trials',
      label: t('attention.trials', { count: overview.trialsEndingSoon.length }),
      tone: 'warn',
    });
  }
  if (overview.expiringTokens > 0) {
    attention.push({
      key: 'tokens',
      label: t('attention.tokens', { count: overview.expiringTokens }),
      tone: 'bad',
    });
  }
  if (overview.accounts.suspended + overview.accounts.banned > 0) {
    attention.push({
      key: 'suspended',
      label: t('attention.suspended', {
        count: overview.accounts.suspended + overview.accounts.banned,
      }),
      tone: 'warn',
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-foreground text-xl font-semibold">
          {t('overview.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('overview.subtitle')}
        </p>
      </header>

      <RegistrationToggle
        enabled={overview.registration.enabled}
        mode={overview.registration.mode}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('kpi.mrr')}
          value={formatMoney(overview.mrrUsd)}
          hint={t('kpi.pastDue') + `: ${overview.subscriptions.pastDue}`}
        />
        <Stat
          label={t('kpi.activeAccounts')}
          value={overview.accounts.active}
          hint={t('kpi.of', { total: overview.accounts.total })}
          tone="ok"
        />
        <Stat
          label={t('kpi.trialsSoon')}
          value={overview.trialsEndingSoon.length}
          hint={
            t('kpi.signups') +
            `: ${overview.signups.last7d} / ${overview.signups.last30d}`
          }
          tone={overview.trialsEndingSoon.length > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label={t('kpi.overdue')}
          value={overview.invoices.overdue}
          hint={formatMoney(overview.invoices.overdueAmount)}
          tone={overview.invoices.overdue > 0 ? 'bad' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AdminCard title={t('overview.attention')} className="lg:col-span-1">
          {attention.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('overview.noAttention')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {attention.map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-sm">
                  <CircleAlert
                    className={
                      item.tone === 'bad'
                        ? 'mt-0.5 size-4 shrink-0 text-red-500'
                        : 'mt-0.5 size-4 shrink-0 text-amber-500'
                    }
                  />
                  <span className="text-foreground">{item.label}</span>
                </li>
              ))}
            </ul>
          )}

          {overview.trialsEndingSoon.length > 0 ? (
            <ul className="border-border mt-3 flex flex-col gap-1 border-t pt-3">
              {overview.trialsEndingSoon.map((account) => (
                <li key={account.id}>
                  <Link
                    href={`/admin/accounts/${account.id}`}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs"
                  >
                    <span className="truncate">
                      {account.brandName || account.name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {humanDays(account.trialEndsAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="border-border mt-4 border-t pt-3">
            <Link
              href="/admin/billing"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
            >
              {t('nav.billing')}
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </AdminCard>

        <AdminCard
          title={t('overview.recent')}
          className="lg:col-span-2"
          actions={
            <Link
              href="/admin/accounts"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
            >
              {t('viewAll')}
              <ArrowUpRight className="size-3.5" />
            </Link>
          }
        >
          <DataTable>
            <THead>
              <TH>{t('col.account')}</TH>
              <TH>{t('col.plan')}</TH>
              <TH>{t('status')}</TH>
              <TH className="text-end">{t('created')}</TH>
            </THead>
            <tbody>
              {overview.recentAccounts.length === 0 ? (
                <EmptyRow colSpan={4}>{t('empty')}</EmptyRow>
              ) : (
                overview.recentAccounts.map((account) => (
                  <tr
                    key={account.id}
                    className="border-border/60 border-b last:border-0"
                  >
                    <TD>
                      <Link
                        href={`/admin/accounts/${account.id}`}
                        className="block min-w-0"
                      >
                        <span className="text-foreground block truncate font-medium hover:underline">
                          {account.brandName || account.name}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {account.ownerEmail ?? '—'}
                        </span>
                      </Link>
                    </TD>
                    <TD>
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-xs">
                          {account.planCode ?? t('plan.none')}
                        </span>
                        <SubStatusChip
                          status={account.subscriptionStatus}
                          locale={locale}
                        />
                      </div>
                    </TD>
                    <TD>
                      <AccountStatusChip
                        status={account.status}
                        locale={locale}
                      />
                    </TD>
                    <TD className="text-end">
                      <span className="text-muted-foreground text-xs">
                        {humanDays(account.createdAt)}
                      </span>
                    </TD>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </AdminCard>
      </div>

    </div>
  );
}
