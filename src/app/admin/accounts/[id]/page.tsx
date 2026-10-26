import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';

import {
  getAccount,
  getSubscription,
  listAudit,
  listChannels,
  listEmails,
  listGrants,
  listInvoices,
  listMembers,
  listPlans,
} from '@/lib/admin/queries';
import { guardAdminPage } from '@/lib/admin/guard-page';
import { adminT } from '@/lib/admin/copy';
import {
  formatDate,
  formatDateTime,
  formatNumber,
} from '@/lib/admin/format';
import { FEATURES, LIMITS } from '@/lib/plans/entitlements';
import {
  AdminCard,
  Chip,
  DataTable,
  EmptyRow,
  Stat,
  TD,
  TH,
  THead,
} from '@/components/admin/ui';
import { AccountStatusChip } from '@/components/admin/status-chips';
import { AccountControls } from '@/components/admin/account-controls';
import { GrantPanel } from '@/components/admin/grant-panel';
import { MembersPanel } from '@/components/admin/members-panel';
import { InvoicePanel } from '@/components/admin/invoice-panel';
import { EmailPanel } from '@/components/admin/email-panel';

export const dynamic = 'force-dynamic';

export default async function AdminAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await guardAdminPage();
  const { id } = await params;
  const locale = await getLocale();
  const t = adminT(locale);

  const account = await getAccount(id);
  if (!account) notFound();

  const [
    members,
    grants,
    subscription,
    invoices,
    channels,
    audit,
    emails,
    plans,
  ] = await Promise.all([
    listMembers(id),
    listGrants(id),
    getSubscription(id),
    listInvoices(id),
    listChannels(),
    listAudit(25, id),
    listEmails(10, id),
    listPlans(),
  ]);

  const accountChannels = channels.filter(
    (channel) => channel.accountId === id
  );
  const notes = (subscription?.notes as string | null) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/admin/accounts"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <ArrowRight className="size-3.5 rtl:rotate-180" />
            {t('detail.back')}
          </Link>
          <h1 className="text-foreground mt-1 truncate text-xl font-semibold">
            {account.brandName || account.name}
          </h1>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
            <AccountStatusChip status={account.status} locale={locale} />
            <span>{account.ownerEmail ?? '—'}</span>
            <span>·</span>
            <span dir="ltr" className="font-mono text-[11px]">
              {account.id}
            </span>
          </div>
          {account.statusReason ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {account.statusReason}
            </p>
          ) : null}
        </div>
        <div className="text-muted-foreground text-xs">
          {formatDate(account.createdAt)}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t('col.members')} value={formatNumber(account.members)} />
        <Stat
          label={t('usage.contacts')}
          value={formatNumber(account.contacts)}
        />
        <Stat
          label={t('usage.conversations')}
          value={formatNumber(account.conversations)}
        />
        <Stat
          label={t('usage.messages30')}
          value={formatNumber(account.messages30d)}
        />
        <Stat
          label={t('col.channels')}
          value={formatNumber(account.channels)}
        />
      </div>

      <AccountControls
        account={account}
        plans={plans.map((plan) => ({ code: plan.code, name: plan.name }))}
        notes={notes}
      />

      <GrantPanel
        accountId={account.id}
        grants={grants}
        features={FEATURES}
        limits={LIMITS}
      />

      <MembersPanel accountId={account.id} members={members} />

      <InvoicePanel
        accountId={account.id}
        invoices={invoices}
        defaultEmail={account.ownerEmail ?? ''}
        defaultName={account.brandName || account.name}
        // Prices are quoted and invoiced in USD (see migration 063).
        currency="USD"
        planCode={account.planCode}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <EmailPanel
          accountId={account.id}
          defaultTo={account.ownerEmail ?? ''}
          defaultName={account.ownerName ?? account.name}
        />

        <AdminCard title={t('nav.channels')}>
          {accountChannels.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('channels.empty')}
            </p>
          ) : (
            <ul className="divide-border/60 flex flex-col divide-y">
              {accountChannels.map((channel) => (
                <li
                  key={channel.id}
                  className="flex items-center gap-2 py-2 text-sm"
                >
                  <Chip tone={channel.isActive ? 'ok' : 'neutral'}>
                    {t(`channel.${channel.channel}`)}
                  </Chip>
                  <span
                    dir="ltr"
                    className="text-muted-foreground truncate font-mono text-[11px]"
                  >
                    {channel.externalId}
                  </span>
                  <span className="text-muted-foreground ms-auto text-[11px]">
                    {channel.tokenExpiresAt
                      ? `${t('channels.tokenExpires')}: ${formatDate(channel.tokenExpiresAt)}`
                      : t('grants.permanent')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Link
              href="/admin/channels"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              {t('viewAll')}
            </Link>
          </div>
        </AdminCard>
      </div>

      <AdminCard title={t('audit.title')}>
        <DataTable>
          <THead>
            <TH>{t('audit.action')}</TH>
            <TH>{t('audit.actor')}</TH>
            <TH className="text-end">{t('audit.when')}</TH>
          </THead>
          <tbody>
            {audit.length === 0 ? (
              <EmptyRow colSpan={3}>{t('audit.empty')}</EmptyRow>
            ) : (
              audit.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-border/60 border-b last:border-0"
                >
                  <TD>
                    <span className="text-foreground font-mono text-[11px]">
                      {entry.action}
                    </span>
                  </TD>
                  <TD className="text-muted-foreground text-xs">
                    {entry.actorEmail ?? '—'}
                  </TD>
                  <TD className="text-muted-foreground text-end text-xs">
                    {formatDateTime(entry.createdAt)}
                  </TD>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </AdminCard>

      <AdminCard title={t('email.title')} description={t('email.desc')}>
        {emails.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <ul className="divide-border/60 flex flex-col divide-y">
            {emails.map((email) => (
              <li
                key={email.id}
                className="flex flex-wrap items-center gap-2 py-1.5 text-xs"
              >
                <Chip
                  tone={
                    email.status === 'sent'
                      ? 'ok'
                      : email.status === 'dry_run'
                        ? 'warn'
                        : email.status === 'failed'
                          ? 'bad'
                          : 'neutral'
                  }
                >
                  {email.status}
                </Chip>
                <span className="text-foreground truncate">
                  {email.subject}
                </span>
                <span className="text-muted-foreground truncate">
                  {email.toEmail}
                </span>
                <span className="text-muted-foreground ms-auto">
                  {formatDateTime(email.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </div>
  );
}
