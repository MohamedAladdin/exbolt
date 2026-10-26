'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { AccountRow } from '@/lib/admin/queries';
import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';

const STATUSES = ['active', 'suspended', 'archived', 'banned'] as const;
const SUB_STATUSES = [
  'trial',
  'active',
  'past_due',
  'canceled',
  'suspended',
] as const;

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground mb-1 block text-[11px] font-medium tracking-wide uppercase">
      {children}
    </span>
  );
}

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none';

export function AccountControls({
  account,
  plans,
  notes,
}: {
  account: AccountRow;
  plans: { code: string; name: string }[];
  notes: string | null;
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();

  const [status, setStatus] = useState(account.status);
  const [reason, setReason] = useState(account.statusReason ?? '');
  const [statusBusy, setStatusBusy] = useState(false);

  const [planCode, setPlanCode] = useState(account.planCode ?? '');
  const [subStatus, setSubStatus] = useState(
    account.subscriptionStatus ?? 'active'
  );
  const [interval, setInterval] = useState(
    account.billingInterval ?? 'monthly'
  );
  const [periodEnd, setPeriodEnd] = useState(
    account.currentPeriodEnd?.slice(0, 10) ?? ''
  );
  const [trialEnd, setTrialEnd] = useState(
    account.trialEndsAt?.slice(0, 10) ?? ''
  );
  const [planBusy, setPlanBusy] = useState(false);

  const [memo, setMemo] = useState(notes ?? '');
  const [notesBusy, setNotesBusy] = useState(false);

  const send = async (
    body: Record<string, unknown>,
    done: () => void,
    setBusy: (v: boolean) => void
  ) => {
    setBusy(true);
    try {
      await adminPatch(`/api/admin/accounts/${account.id}`, body);
      toast.success(t('saved'));
      done();
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-border bg-card rounded-xl border">
      <header className="border-border border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-semibold">
          {t('control.title')}
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('control.desc')}
        </p>
      </header>

      <div className="grid gap-5 p-4 lg:grid-cols-3">
        {/* status */}
        <div className="flex flex-col gap-2">
          <div>
            <Label>{t('control.status')}</Label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as AccountRow['status'])
              }
              className={inputClass}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground mt-1 text-[11px]">
              {t(`statusHint.${status}`)}
            </p>
          </div>
          <div>
            <Label>{t('control.reason')}</Label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('optional')}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            disabled={statusBusy}
            onClick={() =>
              send(
                { action: 'status', status, reason },
                () => {},
                setStatusBusy
              )
            }
            className="bg-foreground text-background mt-1 inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {statusBusy ? t('working') : t('control.applyStatus')}
          </button>
        </div>

        {/* plan */}
        <div className="flex flex-col gap-2">
          <div>
            <Label>{t('control.plan')}</Label>
            <select
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              className={inputClass}
            >
              <option value="">{t('plan.none')}</option>
              {plans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.name} · {plan.code}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t('control.planStatus')}</Label>
              <select
                value={subStatus}
                onChange={(e) => setSubStatus(e.target.value)}
                className={inputClass}
              >
                {SUB_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`sub.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t('control.interval')}</Label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className={inputClass}
              >
                <option value="monthly">{t('control.monthly')}</option>
                <option value="annual">{t('control.annual')}</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t('control.periodEnd')}</Label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <Label>{t('control.trialEnd')}</Label>
              <input
                type="date"
                value={trialEnd}
                onChange={(e) => setTrialEnd(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={planBusy}
            onClick={() =>
              send(
                {
                  action: 'plan',
                  planCode: planCode || null,
                  status: subStatus,
                  billingInterval: interval,
                  currentPeriodEnd: periodEnd ? `${periodEnd}T00:00:00Z` : null,
                  trialEndsAt: trialEnd ? `${trialEnd}T00:00:00Z` : null,
                },
                () => {},
                setPlanBusy
              )
            }
            className="border-border text-foreground hover:bg-muted mt-1 inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {planBusy ? t('working') : t('control.applyPlan')}
          </button>
        </div>

        {/* notes */}
        <div className="flex flex-col gap-2">
          <div className="flex-1">
            <Label>{t('control.notes')}</Label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={5}
              placeholder={t('control.notesPlaceholder')}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-foreground/30 w-full resize-none rounded-md border p-2 text-sm focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={notesBusy}
            onClick={() =>
              send({ action: 'notes', notes: memo }, () => {}, setNotesBusy)
            }
            className="border-border text-foreground hover:bg-muted inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {notesBusy ? t('working') : t('control.saveNotes')}
          </button>
        </div>
      </div>
    </section>
  );
}
