'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import type { PlanRow } from '@/lib/admin/queries';
import { FEATURES, LIMITS } from '@/lib/plans/entitlements';
import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import { Chip } from '@/components/admin/ui';

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none';

function PlanCard({ plan }: { plan: PlanRow }) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [monthly, setMonthly] = useState(String(plan.priceMonthlyUsd));
  const [annual, setAnnual] = useState(
    plan.priceAnnualUsd === null ? '' : String(plan.priceAnnualUsd)
  );
  const [features, setFeatures] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const feature of FEATURES)
      initial[feature] = plan.features[feature] === true;
    return initial;
  });
  const [limits, setLimits] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of LIMITS) {
      const value = plan.limits[key];
      initial[key] =
        value === null ? '' : value === undefined ? '' : String(value);
    }
    return initial;
  });

  const save = async () => {
    setBusy(true);
    try {
      const limitPayload: Record<string, number | null> = {};
      for (const key of LIMITS) {
        const raw = limits[key];
        limitPayload[key] = raw.trim() === '' ? null : Number(raw);
      }
      await adminPatch('/api/admin/plans', {
        code: plan.code,
        priceMonthlyUsd: Number(monthly) || 0,
        priceAnnualUsd: annual.trim() === '' ? null : Number(annual),
        features,
        limits: limitPayload,
      });
      toast.success(t('saved'));
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-semibold">
            {plan.name}{' '}
            <span className="text-muted-foreground font-mono text-xs">
              {plan.code}
            </span>
          </h3>
          <p className="text-muted-foreground text-xs">
            {t('plan.subscribers', { count: plan.subscribers })}
          </p>
        </div>
        <Chip tone={plan.isActive ? 'ok' : 'neutral'}>{t('plan.active')}</Chip>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
            {t('plan.monthly')} (USD)
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
            {t('plan.annual')} (USD)
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={annual}
            onChange={(e) => setAnnual(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-3">
        <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
          {t('plan.features')}
        </span>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {FEATURES.map((feature) => (
            <label
              key={feature}
              className="text-muted-foreground flex items-center gap-1.5 text-[11px]"
            >
              <input
                type="checkbox"
                checked={features[feature] === true}
                onChange={(event) =>
                  setFeatures((current) => ({
                    ...current,
                    [feature]: event.target.checked,
                  }))
                }
                className="border-border size-3.5 rounded"
              />
              <span className={features[feature] ? 'text-foreground' : ''}>
                {feature}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
          {t('plan.limits')} ({t('plan.limitUnlimited')} = فارغ)
        </span>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {LIMITS.map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px]">{key}</span>
              <input
                type="number"
                min={0}
                value={limits[key] ?? ''}
                onChange={(event) =>
                  setLimits((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                placeholder={t('plan.limitUnlimited')}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="border-border text-foreground hover:bg-muted mt-3 inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium disabled:opacity-50"
      >
        {busy ? t('working') : t('plan.save')}
      </button>
    </div>
  );
}

export function PlansEditor({ plans }: { plans: PlanRow[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {plans.map((plan) => (
        <PlanCard key={plan.code} plan={plan} />
      ))}
    </div>
  );
}
