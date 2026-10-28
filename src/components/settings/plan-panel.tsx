"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRightLeft,
  CalendarDays,
  Check,
  CreditCard,
  Loader2,
  Minus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { useEntitlements } from "@/hooks/use-entitlements";
import { FEATURES, LIMITS, type Feature, type LimitKey } from "@/lib/plans/entitlements";
import { VENDOR_NAME, VENDOR_URL } from "@/lib/branding";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

interface PlanOption {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  price_monthly_usd: number | string;
  price_annual_usd: number | string | null;
  limits: Record<string, unknown>;
  sort_order: number;
}

interface AccountRequest {
  id: string;
  kind: "renewal" | "change_plan";
  current_plan_code: string | null;
  requested_plan_code: string | null;
  billing_interval: "monthly" | "annual";
  message: string | null;
  status: "new" | "in_review" | "done" | "declined";
  created_at: string;
}

const DAY = 86_400_000;

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Settings → Plan.
 *
 * The plan itself is billing state, written only by the super-admin panel /
 * billing webhook. This panel shows the subscription window and lets an
 * account admin *request* a renewal or a plan change — a request row lands in
 * /admin/requests; no entitlement changes until the platform team approves it.
 */
export function PlanPanel() {
  const t = useTranslations("Settings.plan");
  const locale = useLocale();
  const { entitlements, loading, error } = useEntitlements();
  const { canEditSettings } = useAuth();

  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [requests, setRequests] = useState<AccountRequest[]>([]);
  const [dialog, setDialog] = useState<"renewal" | "change_plan" | null>(null);
  const [targetPlan, setTargetPlan] = useState("");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const loadRequests = async () => {
    const res = await fetch("/api/account/requests", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json().catch(() => ({}))) as { requests?: AccountRequest[] };
    setRequests(data.requests ?? []);
  };

  useEffect(() => {
    if (!canEditSettings) return;
    let cancelled = false;
    void (async () => {
      try {
        const [plansRes, requestsRes] = await Promise.all([
          fetch("/api/account/plans", { cache: "no-store" }),
          fetch("/api/account/requests", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (plansRes.ok) {
          const data = (await plansRes.json()) as { plans?: PlanOption[] };
          setPlans(data.plans ?? []);
        }
        if (requestsRes.ok) {
          const data = (await requestsRes.json()) as { requests?: AccountRequest[] };
          setRequests(data.requests ?? []);
        }
      } catch {
        /* the panel still renders; the dialogs will be empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEditSettings]);

  const pending = useMemo(
    () => requests.find((request) => ["new", "in_review"].includes(request.status)) ?? null,
    [requests],
  );

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
        <div className="mt-8 h-40 animate-pulse rounded-xl border border-border bg-muted/40" />
      </section>
    );
  }

  const planName =
    locale === "ar"
      ? entitlements.plan.name_ar || entitlements.plan.name
      : entitlements.plan.name;
  const statusTone: Record<string, string> = {
    active: "border-emerald-500/40 text-emerald-500",
    trial: "border-sky-500/40 text-sky-500",
    past_due: "border-amber-500/40 text-amber-500",
    canceled: "border-red-500/40 text-red-500",
    suspended: "border-red-500/40 text-red-500",
  };

  const startsAt = entitlements.started_at;
  const endsAt =
    entitlements.status === "trial"
      ? entitlements.trial_ends_at ?? entitlements.current_period_end
      : entitlements.current_period_end;
  const endMs = endsAt ? new Date(endsAt).getTime() : null;
  const startMs = startsAt ? new Date(startsAt).getTime() : null;
  const remaining = endMs === null ? null : Math.ceil((endMs - Date.now()) / DAY);
  const expired = remaining !== null && remaining <= 0;
  // Show the *remaining* share of the window, not elapsed time: a freshly
  // renewed annual plan should look full, not like an empty/broken bar.
  const progress =
    startMs !== null && endMs !== null && endMs > startMs && remaining !== null
      ? Math.min(100, Math.max(0, (remaining / ((endMs - startMs) / DAY)) * 100))
      : null;

  const warnings: { tone: "amber" | "red"; text: string }[] = [];
  if (!entitlements.entitled) {
    warnings.push({ tone: "red", text: t("notEntitled") });
  }
  if (entitlements.status === "past_due") {
    warnings.push({ tone: "red", text: t("pastDue") });
  }
  if (entitlements.status === "trial" && remaining !== null && remaining <= 7) {
    warnings.push({
      tone: "amber",
      text: t("trialEnding", { days: Math.max(remaining, 0) }),
    });
  }
  if (entitlements.status === "active" && expired) {
    warnings.push({ tone: "red", text: t("expiredOn", { date: formatDate(endsAt, locale) }) });
  } else if (
    entitlements.status === "active" &&
    remaining !== null &&
    remaining > 0 &&
    remaining <= 14
  ) {
    warnings.push({ tone: "amber", text: t("expiringSoon", { days: remaining }) });
  }

  const planLabel = (code: string | null) => {
    const found = plans.find((plan) => plan.code === code);
    if (!found) return code ?? "—";
    return locale === "ar" ? found.name_ar || found.name : found.name;
  };

  const openDialog = (kind: "renewal" | "change_plan") => {
    setDialog(kind);
    setBillingCycle(entitlements.billing_interval);
    setTargetPlan(plans.find((plan) => plan.code !== entitlements.plan.code)?.code ?? "");
    setNote("");
    setFormError("");
  };

  const submitRequest = async () => {
    if (!dialog || submitting) return;
    if (dialog === "change_plan" && !targetPlan) {
      setFormError(t("requestFailed"));
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch("/api/account/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: dialog,
          requestedPlanCode:
            dialog === "change_plan" ? targetPlan : entitlements.plan.code,
          billingInterval: billingCycle,
          message: note,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        request?: AccountRequest;
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 409 || data.error === "request_pending") {
          setFormError(t("requestPendingError"));
          void loadRequests();
        } else {
          setFormError(t("requestFailed"));
        }
        return;
      }
      if (data.request) {
        setRequests((current) => [data.request as AccountRequest, ...current]);
      }
      setDialog(null);
      toast.success(t("requestSent"));
    } catch {
      setFormError(t("requestFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const barTone = expired
    ? "bg-red-500"
    : remaining !== null && remaining <= 14
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {pending ? (
        <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-sky-600 dark:text-sky-400">
            <RefreshCw className="size-4" />
            {t("pendingTitle")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending.kind === "renewal"
              ? t("pendingRenewal", { plan: planLabel(pending.requested_plan_code) })
              : t("pendingChange", {
                  from: planLabel(pending.current_plan_code),
                  to: planLabel(pending.requested_plan_code),
                })}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("pendingSince", { date: formatDate(pending.created_at, locale) })}
          </p>
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <CreditCard className="size-4 text-primary" />
                {planName}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {t("currentPlan")}
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
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CalendarDays className="size-3" />
                {t("startedAt")}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {formatDate(startsAt, locale)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CalendarDays className="size-3" />
                {t("endsAt")}
              </p>
              <p
                className={cn(
                  "mt-1 text-sm font-semibold",
                  expired ? "text-red-500" : "text-foreground",
                )}
              >
                {formatDate(endsAt, locale)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] text-muted-foreground">{t("billing")}</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {t(`interval.${entitlements.billing_interval}`)}
              </p>
            </div>
          </div>

          {progress !== null ? (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", barTone)}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {remaining === null
                  ? t("noDate")
                  : remaining <= 0
                    ? t("expiredOn", { date: formatDate(endsAt, locale) })
                    : remaining === 1
                      ? t("daysLeftOne")
                      : t("daysLeft", { days: remaining })}
              </p>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="space-y-2">
              {warnings.map((warning) => (
                <p
                  key={warning.text}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-3 text-xs",
                    warning.tone === "red"
                      ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  )}
                >
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {warning.text}
                </p>
              ))}
            </div>
          ) : null}

          {canEditSettings ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                onClick={() => openDialog("renewal")}
                disabled={Boolean(pending)}
              >
                <RefreshCw className="size-4" />
                {t("renew")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => openDialog("change_plan")}
                disabled={Boolean(pending) || plans.length === 0}
              >
                <ArrowRightLeft className="size-4" />
                {t("changePlan")}
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("adminOnlyHint")}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
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
          </div>

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

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog === "change_plan" ? t("changeTitle") : t("renewTitle")}
            </DialogTitle>
            <DialogDescription>
              {dialog === "change_plan" ? t("changeDesc") : t("renewDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {dialog === "change_plan" ? (
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("requestPlan")}</Label>
                <Select
                  value={targetPlan}
                  onValueChange={(value) => value && setTargetPlan(value)}
                >
                  <SelectTrigger className="w-full border-border bg-muted text-foreground">
                    <SelectValue>{planLabel(targetPlan)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {plans
                      .filter((plan) => plan.code !== entitlements.plan.code)
                      .map((plan) => (
                        <SelectItem key={plan.code} value={plan.code}>
                          <span className="flex items-center gap-2">
                            {locale === "ar" ? plan.name_ar || plan.name : plan.name}
                            <span className="text-muted-foreground text-[11px]" dir="ltr">
                              ${plan.price_monthly_usd}/{t("interval.monthly")}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-[11px] text-muted-foreground">{t("currentPlanLabel")}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{planName}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t("requestInterval")}</Label>
              <Select
                value={billingCycle}
                onValueChange={(value) =>
                  value && setBillingCycle(value as "monthly" | "annual")
                }
              >
                <SelectTrigger className="w-full border-border bg-muted text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">{t("interval.monthly")}</SelectItem>
                  <SelectItem value="annual">{t("interval.annual")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {t("requestNote")}{" "}
                <span className="text-[11px] text-muted-foreground">{t("optional")}</span>
              </Label>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("requestNotePlaceholder")}
                maxLength={1500}
                rows={3}
              />
            </div>

            {formError ? (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400">
                {formError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => void submitRequest()} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("sendingRequest")}
                </>
              ) : (
                t("sendRequest")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
