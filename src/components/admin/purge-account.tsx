'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';

import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import { AdminCard } from '@/components/admin/ui';

/**
 * The delete-tenant control.
 *
 * Deliberately not a one-click button and deliberately not a modal you can
 * dismiss with muscle memory: the panel expands in place, shows exactly what
 * will disappear, and arms itself only when the operator types the account
 * name. The server re-checks that name and refuses accounts that carry
 * billing history or a platform admin — the UI copy here is a courtesy, the
 * guards are in `purgeAccount`.
 */
export function PurgeAccountPanel({
  accountId,
  accountName,
  counts,
}: {
  accountId: string;
  accountName: string;
  counts: {
    members: number;
    contacts: number;
    conversations: number;
    messages: number;
  };
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();

  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const matches =
    typed.trim().toLowerCase() === accountName.trim().toLowerCase() &&
    accountName.trim().length > 0;

  const submit = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await adminPatch(`/api/admin/accounts/${accountId}`, {
        action: 'purge',
        confirmation: typed,
      });
      toast.success(t('purge.done'));
      // The account row no longer exists — go back to the list instead of
      // leaving the operator on a detail page that will 404 on refresh.
      router.push('/admin/accounts');
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
      setBusy(false);
    }
  };

  const rows: { label: string; value: number }[] = [
    { label: t('col.members'), value: counts.members },
    { label: t('usage.contacts'), value: counts.contacts },
    { label: t('usage.conversations'), value: counts.conversations },
    { label: t('usage.messages30'), value: counts.messages },
  ];

  return (
    <AdminCard
      title={
        <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
          <AlertTriangle className="size-4" />
          {t('purge.title')}
        </span>
      }
      description={t('purge.subtitle')}
    >
      <div className="space-y-3 p-4">
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t('purge.intro')}
        </p>

        <div className="border-border rounded-lg border p-3">
          <p className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">
            {t('purge.counts')}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <div className="text-foreground text-sm font-semibold tabular-nums">
                  {new Intl.NumberFormat(locale).format(row.value)}
                </div>
                <div className="text-muted-foreground truncate text-[11px]">
                  {row.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {!armed ? (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="inline-flex h-8 items-center rounded-md border border-red-500/40 px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            {t('purge.title')}
          </button>
        ) : (
          <div className="space-y-2">
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-[11px] font-medium tracking-wide uppercase">
                {t('purge.confirmLabel')}
              </span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit();
                  if (event.key === 'Escape') {
                    setArmed(false);
                    setTyped('');
                  }
                }}
                dir="auto"
                autoFocus
                className="border-border bg-background text-foreground focus:border-red-500/50 h-8 w-full rounded-md border px-2 text-sm focus:outline-none"
                placeholder={accountName}
              />
            </label>
            <p className="text-muted-foreground text-[11px]">
              {t('purge.confirmHint', { name: accountName })}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!matches || busy}
                onClick={() => void submit()}
                className="inline-flex h-8 items-center rounded-md bg-red-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? t('purge.busy') : t('purge.action')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setArmed(false);
                  setTyped('');
                }}
                className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center rounded-md px-3 text-xs"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminCard>
  );
}
