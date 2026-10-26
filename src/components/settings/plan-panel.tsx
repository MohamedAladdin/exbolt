"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, CreditCard, Minus, ShieldCheck, TriangleAlert } from "lucide-react";

import { useEntitlements } from "@/hooks/use-entitlements";
import { FEATURES, LIMITS, type Feature, type LimitKey } from "@/lib/plans/entitlements";
import { VENDOR_NAME, VENDOR_URL } from "@/lib/branding";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Settings → Plan.
 *
 * Read-only in this release: it answers "what am I paying for and what is
 * switched on?" — the plan itself is billing state, written only by the
 * super-admin panel / billing webhook (service role). That is deliberate:
 * a client admin must never be able to grant themselves API access by
 * flipping a switch in their own settings.
 */
export function PlanPanel() {
  const t = useTranslations("Settings.plan");
  const locale = useLocale();
  const { entitlements, loading, error } = useEntitlements();

  if (loading) {
    return (
      <section className="max-w-3xl">
        <SettingsPanelHead title={t("title")} description={t("description")} />
        <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" />
      </section>
    );
  }

  if (error || !entitlements) {
    return (
      <section className="max-w-3xl">
        <SettingsPanelHead title={t("title")} description={t("description")} />
        <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
      </section>
    );
  }

  const planName = locale === "ar" ? entitlements.plan.name_ar || entitlements.plan.name : entitlements.plan.name;
  const statusTone: Record<string, string> = {
    active: "border-emerald-500/40 text-emerald-500",
    trial: "border-sky-500/40 text-sky-500",
    past_due: "border-amber-500/40 text-amber-500",
    canceled: "border-red-500/40 text-red-500",
    suspended: "border-red-500/40 text-red-500",
  };

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <CreditCard className="size-4 text-primary" />
                {planName}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {entitlements.plan.tagline ?? t("currentPlan")}
              </CardDescription>
            </div>
            <Badge variant="outline" className={cn("gap-1", statusTone[entitlements.status])}>
              <ShieldCheck className="size-3" />
              {t(`status.${entitlements.status}`)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] text-muted-foreground">{t("monthly")}</p>
              <p className="mt-1 text-lg font-semibold text-foreground" dir="ltr">
                ${entitlements.plan.price_monthly_usd}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] text-muted-foreground">{t("annual")}</p>
              <p className="mt-1 text-lg font-semibold text-foreground" dir="ltr">
                {entitlements.plan.price_annual_usd
                  ? `$${entitlements.plan.price_annual_usd}`
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] text-muted-foreground">{t("billing")}</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {t(`interval.${entitlements.billing_interval}`)}
              </p>
            </div>
          </div>

          {!entitlements.entitled && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {t("notEntitled")}
            </p>
          )}

          {/* Limits. `null` = unlimited, rendered as ∞ rather than hidden. */}
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">{t("limits")}</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              {LIMITS.map((key: LimitKey) => {
                const value = entitlements.limits[key];
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <dt className="text-muted-foreground">{t(`limit.${key}`)}</dt>
                    <dd className="font-medium text-foreground" dir="ltr">
                      {value === null ? "∞" : value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t("features")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("featuresDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {FEATURES.map((feature: Feature) => {
              const on = entitlements.features[feature] !== false && entitlements.entitled;
              return (
                <li
                  key={feature}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                    on ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {on ? (
                    <Check className="size-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <Minus className="size-3.5 shrink-0 opacity-50" />
                  )}
                  {t(`feature.${feature}`)}
                </li>
              );
            })}
          </ul>

          <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
            {t("billingNote")}{" "}
            <a
              href={VENDOR_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              {VENDOR_NAME}
            </a>
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
