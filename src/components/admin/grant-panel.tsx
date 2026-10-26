'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Gift, X } from 'lucide-react';

import type { GrantRow } from '@/lib/admin/queries';
import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import { formatDate } from '@/lib/admin/format';
import { Chip } from '@/components/admin/ui';

const KINDS = [
  'feature',
  'limit',
  'trial_extension',
  'discount',
  'credit',
] as const;

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none';

export function GrantPanel({
  accountId,
  grants,
  features,
  limits,
}: {
  accountId: string;
  grants: GrantRow[];
  features: readonly string[];
  limits: readonly string[];
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('feature');
  const [key, setKey] = useState<string>(features[0] ?? '');
  const [flag, setFlag] = useState('true');
  const [number, setNumber] = useState('1');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');

  const changeKind = (next: (typeof KINDS)[number]) => {
    setKind(next);
    if (next === 'feature') setKey(features[0] ?? '');
    else if (next === 'limit') setKey(limits[0] ?? '');
    else setKey('');
  };

  const submit = async () => {
    const body: Record<string, unknown> = {
      action: 'grant',
      kind,
      key: kind === 'feature' || kind === 'limit' ? key : null,
      reason: reason || null,
      expiresAt: expires ? `${expires}T23:59:59Z` : null,
    };
    if (kind === 'feature') body.value = flag === 'true';
    if (kind === 'limit') body.value = Number(number);
    if (kind === 'trial_extension') body.value = { months: Number(number) };
    if (kind === 'discount') body.value = { percent: Number(number) };
    if (kind === 'credit')
      body.value = { amount: Number(number), currency: 'USD' };

    setBusy(true);
    try {
      await adminPatch(`/api/admin/accounts/${accountId}`, body);
      toast.success(t('saved'));
      setOpen(false);
      setReason('');
      setExpires('');
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (grantId: string) => {
    setBusy(true);
    try {
      await adminPatch(`/api/admin/accounts/${accountId}`, {
        action: 'revoke_grant',
        grantId,
      });
      toast.success(t('done'));
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();

  return (
    <section className="border-border bg-card rounded-xl border">
      <header className="border-border flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Gift className="text-muted-foreground size-4" />
            {t('grants.title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('grants.desc')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="border-border text-foreground hover:bg-muted inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-xs font-medium"
        >
          {open ? t('close') : t('grants.add')}
        </button>
      </header>

      {open ? (
        <div className="border-border grid gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
              {t('grants.kind')}
            </span>
            <select
              value={kind}
              onChange={(e) => changeKind(e.target.value as typeof kind)}
              className={inputClass}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`grant.kind.${value}`)}
                </option>
              ))}
            </select>
          </label>

          {kind === 'feature' ? (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {t('grants.key')}
              </span>
              <select
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className={inputClass}
              >
                {features.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {kind === 'limit' ? (
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {t('grants.key')}
              </span>
              <select
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className={inputClass}
              >
                {limits.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
              {t('grants.value')}
            </span>
            {kind === 'feature' ? (
              <select
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                className={inputClass}
              >
                <option value="true">on</option>
                <option value="false">off</option>
              </select>
            ) : (
              <input
                type="number"
                min={0}
                step={kind === 'credit' ? '0.01' : '1'}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className={inputClass}
              />
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
              {t('grants.expires')}
            </span>
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
              {t('grants.reason')}
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputClass}
            />
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="bg-foreground text-background mt-auto inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t('working') : t('grants.add')}
          </button>
        </div>
      ) : null}

      <div className="p-4">
        {grants.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('grants.empty')}</p>
        ) : (
          <ul className="divide-border/60 flex flex-col divide-y">
            {grants.map((grant) => {
              const expired = grant.expiresAt
                ? new Date(grant.expiresAt).getTime() <= now
                : false;
              const dead = Boolean(grant.revokedAt) || expired;
              return (
                <li
                  key={grant.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <Chip tone={dead ? 'neutral' : 'ok'}>
                    {t(`grant.kind.${grant.kind}`)}
                  </Chip>
                  <span className="text-foreground font-medium">
                    {grant.key ?? '—'}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {typeof grant.value === 'object'
                      ? JSON.stringify(grant.value)
                      : String(grant.value)}
                  </span>
                  {grant.reason ? (
                    <span className="text-muted-foreground text-xs">
                      · {grant.reason}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground ms-auto text-xs">
                    {grant.revokedAt
                      ? t('grants.revoked')
                      : grant.expiresAt
                        ? `${t('grants.expires')} ${formatDate(grant.expiresAt)}`
                        : t('grants.permanent')}
                  </span>
                  {!dead ? (
                    <button
                      type="button"
                      onClick={() => revoke(grant.id)}
                      disabled={busy}
                      className="border-border text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
                    >
                      <X className="size-3" />
                      {t('grants.revoke')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
