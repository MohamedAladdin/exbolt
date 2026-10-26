'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ChannelRow } from '@/lib/admin/queries';
import { adminRequest } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import { formatDate } from '@/lib/admin/format';
import {
  Chip,
  DataTable,
  EmptyRow,
  TD,
  TH,
  THead,
} from '@/components/admin/ui';

export function ChannelsTable({ rows }: { rows: ChannelRow[] }) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (
    row: ChannelRow,
    action: 'enable' | 'disable' | 'revoke'
  ) => {
    if (action === 'revoke' && !window.confirm(t('channels.confirmRevoke')))
      return;
    setBusy(row.id);
    try {
      await adminRequest('/api/admin/channels', {
        action,
        channel: row.channel,
        id: row.id,
      });
      toast.success(t('done'));
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(null);
    }
  };

  const expiring = (iso: string | null) => {
    if (!iso) return null;
    const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
    if (days < 0) return <Chip tone="bad">{t('grants.expired')}</Chip>;
    if (days <= 14) return <Chip tone="warn">{days}d</Chip>;
    return null;
  };

  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <DataTable>
        <THead>
          <TH>{t('col.account')}</TH>
          <TH>{t('channels.channel')}</TH>
          <TH>{t('channels.external')}</TH>
          <TH>{t('status')}</TH>
          <TH>{t('channels.tokenExpires')}</TH>
          <TH className="text-end">{t('actions')}</TH>
        </THead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={6}>{t('channels.empty')}</EmptyRow>
          ) : (
            rows.map((row) => (
              <tr
                key={`${row.channel}:${row.id}`}
                className="border-border/60 border-b last:border-0"
              >
                <TD>
                  <span className="text-foreground block truncate text-sm">
                    {row.accountName}
                  </span>
                  {row.accountStatus !== 'active' ? (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">
                      {t(`status.${row.accountStatus}`)}
                    </span>
                  ) : null}
                </TD>
                <TD>
                  <Chip tone={row.channel === 'whatsapp' ? 'ok' : 'info'}>
                    {t(`channel.${row.channel}`)}
                  </Chip>
                </TD>
                <TD>
                  <span
                    dir="ltr"
                    className="text-muted-foreground font-mono text-[11px]"
                  >
                    {row.externalId}
                    {row.displayName && row.displayName !== row.externalId
                      ? ` · ${row.displayName}`
                      : ''}
                  </span>
                  {row.lastError ? (
                    <span
                      className="mt-0.5 block max-w-56 truncate text-[11px] text-red-500"
                      title={row.lastError}
                    >
                      {row.lastError}
                    </span>
                  ) : null}
                </TD>
                <TD>
                  <Chip tone={row.isActive ? 'ok' : 'neutral'}>
                    {row.isActive
                      ? t('channels.active')
                      : t('channels.inactive')}
                  </Chip>
                </TD>
                <TD>
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    {row.tokenExpiresAt
                      ? formatDate(row.tokenExpiresAt)
                      : t('grants.permanent')}
                    {expiring(row.tokenExpiresAt)}
                  </div>
                </TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() =>
                        act(row, row.isActive ? 'disable' : 'enable')
                      }
                      className="border-border text-foreground hover:bg-muted rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
                    >
                      {row.isActive
                        ? t('channels.disable')
                        : t('channels.enable')}
                    </button>
                    <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => act(row, 'revoke')}
                      className="border-border hover:bg-muted rounded-md border px-2 py-1 text-[11px] text-red-500 disabled:opacity-50"
                    >
                      {t('channels.revoke')}
                    </button>
                  </div>
                </TD>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </div>
  );
}
