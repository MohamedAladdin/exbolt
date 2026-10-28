'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import type { LandingSettingsRow, PlanRow } from '@/lib/admin/queries';
import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import { FEATURE_LABELS, MARKETING_FEATURES } from '@/lib/landing/features';

const inputClass =
  'h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus:border-foreground/30 focus:outline-none';
const labelClass =
  'text-muted-foreground text-[11px] font-medium uppercase tracking-wide';

interface DraftPlan {
  code: string;
  name: string;
  nameAr: string;
  descAr: string;
  descEn: string;
  monthly: string;
  annual: string;
  featured: boolean;
  active: boolean;
  limits: Record<string, string>;
  features: string[];
}

function toDraft(plan: PlanRow): DraftPlan {
  return {
    code: plan.code,
    name: plan.name,
    nameAr: plan.nameAr ?? '',
    descAr: plan.landingDescAr ?? '',
    descEn: plan.landingDescEn ?? '',
    monthly: String(plan.priceMonthlyUsd),
    annual: plan.priceAnnualUsd === null ? '' : String(plan.priceAnnualUsd),
    featured: plan.isFeatured,
    active: plan.isActive,
    limits: {
      channels: plan.limits.channels === null ? '' : String(plan.limits.channels ?? ''),
      team_members:
        plan.limits.team_members === null ? '' : String(plan.limits.team_members ?? ''),
      broadcast_monthly:
        plan.limits.broadcast_monthly === null
          ? ''
          : String(plan.limits.broadcast_monthly ?? ''),
      ai_agents: plan.limits.ai_agents === null ? '' : String(plan.limits.ai_agents ?? ''),
    },
    features: plan.landingFeatures,
  };
}

export function LandingEditor({
  settings,
  plans,
}: {
  settings: LandingSettingsRow;
  plans: PlanRow[];
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const lang = locale === 'ar' ? 'ar' : 'en';

  const [contact, setContact] = useState({
    salesEmail: settings.salesEmail,
    salesPhone: settings.salesPhone ?? '',
    whatsappNumber: settings.whatsappNumber ?? '',
    responseTimeAr: settings.responseTimeAr,
    responseTimeEn: settings.responseTimeEn,
  });
  const [drafts, setDrafts] = useState<DraftPlan[]>(() => plans.map(toDraft));
  const [busy, setBusy] = useState(false);

  const patchPlan = (code: string, patch: Partial<DraftPlan>) => {
    setDrafts((current) =>
      current.map((plan) => (plan.code === code ? { ...plan, ...patch } : plan))
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      await adminPatch('/api/admin/landing', {
        contact,
        plans: drafts.map((plan) => ({
          code: plan.code,
          nameAr: plan.nameAr,
          landingDescAr: plan.descAr,
          landingDescEn: plan.descEn,
          priceMonthlyUsd: Number(plan.monthly) || 0,
          priceAnnualUsd: plan.annual.trim() === '' ? null : Number(plan.annual) || 0,
          isFeatured: plan.featured,
          isActive: plan.active,
          landingFeatures: plan.features,
          limits: {
            channels: plan.limits.channels.trim() === '' ? null : Number(plan.limits.channels),
            team_members:
              plan.limits.team_members.trim() === '' ? null : Number(plan.limits.team_members),
            broadcast_monthly:
              plan.limits.broadcast_monthly.trim() === ''
                ? null
                : Number(plan.limits.broadcast_monthly),
            ai_agents:
              plan.limits.ai_agents.trim() === '' ? null : Number(plan.limits.ai_agents),
          },
        })),
      });
      toast.success(t('landing.saved'));
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-20">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-foreground text-xl font-semibold">{t('landing.title')}</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {t('landing.subtitle')}
          </p>
        </div>
        <a
          href="/admin/billing"
          className="border-border text-muted-foreground hover:text-foreground inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs"
        >
          {t('landing.billingLink')}
          <ExternalLink className="size-3" />
        </a>
      </header>

      <section className="border-border bg-card rounded-xl border">
        <div className="border-border border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('landing.contactTitle')}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t('landing.contactHint')}</p>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>{t('landing.salesEmail')}</span>
            <input
              dir="ltr"
              type="email"
              value={contact.salesEmail}
              onChange={(event) => setContact({ ...contact, salesEmail: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>{t('landing.salesPhone')}</span>
            <input
              dir="ltr"
              type="tel"
              value={contact.salesPhone}
              onChange={(event) => setContact({ ...contact, salesPhone: event.target.value })}
              className={inputClass}
              placeholder="+20…"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>{t('landing.whatsapp')}</span>
            <input
              dir="ltr"
              type="tel"
              value={contact.whatsappNumber}
              onChange={(event) =>
                setContact({ ...contact, whatsappNumber: event.target.value })
              }
              className={inputClass}
              placeholder="+20…"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>{t('landing.responseAr')}</span>
            <input
              value={contact.responseTimeAr}
              onChange={(event) =>
                setContact({ ...contact, responseTimeAr: event.target.value })
              }
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 md:col-span-2 xl:col-span-1">
            <span className={labelClass}>{t('landing.responseEn')}</span>
            <input
              dir="ltr"
              value={contact.responseTimeEn}
              onChange={(event) =>
                setContact({ ...contact, responseTimeEn: event.target.value })
              }
              className={inputClass}
            />
          </label>
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{t('landing.plansTitle')}</h2>
            <p className="text-muted-foreground mt-0.5 max-w-3xl text-xs">
              {t('landing.plansHint')}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {drafts.map((plan) => (
            <article key={plan.code} className="border-border bg-card rounded-xl border">
              <header className="border-border flex flex-wrap items-center gap-3 border-b px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">
                    {plan.name}{' '}
                    <span className="text-muted-foreground font-mono text-[11px]">
                      {plan.code}
                    </span>
                  </h3>
                </div>
                <div className="ms-auto flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={plan.featured}
                      onChange={(event) =>
                        patchPlan(plan.code, { featured: event.target.checked })
                      }
                      className="border-border size-3.5 rounded"
                    />
                    {t('landing.featured')}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={plan.active}
                      onChange={(event) =>
                        patchPlan(plan.code, { active: event.target.checked })
                      }
                      className="border-border size-3.5 rounded"
                    />
                    {t('landing.active')}
                  </label>
                </div>
              </header>

              <div className="grid gap-4 p-4 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5">
                      <span className={labelClass}>{t('landing.nameAr')}</span>
                      <input
                        value={plan.nameAr}
                        onChange={(event) =>
                          patchPlan(plan.code, { nameAr: event.target.value })
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className={labelClass}>{t('plan.monthly')} (USD)</span>
                      <input
                        dir="ltr"
                        type="number"
                        min={0}
                        step="0.01"
                        value={plan.monthly}
                        onChange={(event) =>
                          patchPlan(plan.code, { monthly: event.target.value })
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 sm:col-span-2">
                      <span className={labelClass}>{t('landing.descAr')}</span>
                      <textarea
                        rows={2}
                        value={plan.descAr}
                        onChange={(event) =>
                          patchPlan(plan.code, { descAr: event.target.value })
                        }
                        className="border-border bg-background text-foreground focus:border-foreground/30 w-full rounded-md border p-2 text-sm focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 sm:col-span-2">
                      <span className={labelClass}>{t('landing.descEn')}</span>
                      <textarea
                        dir="ltr"
                        rows={2}
                        value={plan.descEn}
                        onChange={(event) =>
                          patchPlan(plan.code, { descEn: event.target.value })
                        }
                        className="border-border bg-background text-foreground focus:border-foreground/30 w-full rounded-md border p-2 text-sm focus:outline-none"
                      />
                    </label>
                  </div>
                </div>

                <div className="grid content-start gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className={labelClass}>{t('landing.annual')}</span>
                      <input
                        dir="ltr"
                        type="number"
                        min={0}
                        step="0.01"
                        value={plan.annual}
                        onChange={(event) =>
                          patchPlan(plan.code, { annual: event.target.value })
                        }
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        ['channels', 'landing.channels'],
                        ['team_members', 'landing.users'],
                        ['broadcast_monthly', 'landing.messages'],
                        ['ai_agents', 'landing.agents'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex flex-col gap-1.5">
                        <span className={labelClass}>{t(label)}</span>
                        <input
                          dir="ltr"
                          type="number"
                          min={0}
                          value={plan.limits[key] ?? ''}
                          onChange={(event) =>
                            patchPlan(plan.code, {
                              limits: { ...plan.limits, [key]: event.target.value },
                            })
                          }
                          className={inputClass}
                          placeholder="∞"
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-muted-foreground text-[11px]">{t('landing.unlimited')}</p>
                </div>
              </div>

              <div className="border-border border-t px-4 py-3">
                <details>
                  <summary className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs font-medium">
                    {t('landing.features')}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums">
                      {t('landing.selected', { count: plan.features.length })}
                    </span>
                  </summary>
                  <p className="text-muted-foreground mt-2 text-[11px]">
                    {t('landing.featuresHint')}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-4">
                    {MARKETING_FEATURES.map((code) => {
                      const checked = plan.features.includes(code);
                      return (
                        <label
                          key={code}
                          className="text-muted-foreground flex items-center gap-1.5 text-[11px]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              patchPlan(plan.code, {
                                features: event.target.checked
                                  ? [...plan.features, code]
                                  : plan.features.filter((item) => item !== code),
                              })
                            }
                            className="border-border size-3.5 rounded"
                          />
                          <span className={checked ? 'text-foreground' : ''}>
                            {FEATURE_LABELS[code]?.[lang] ?? code}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 px-4 py-3 backdrop-blur lg:ps-60">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="bg-foreground text-background inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-xs font-medium disabled:opacity-50"
          >
            <Check className="size-3.5" />
            {busy ? t('landing.saving') : t('landing.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
