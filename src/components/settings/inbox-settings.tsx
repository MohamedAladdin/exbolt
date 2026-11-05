"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ListFilter, Loader2, PenLine, Timer } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { parseReplyTarget } from "@/lib/settings/reply-target";
import { DEFAULT_INBOX_FILTER, INBOX_FILTERS, type InboxFilter } from "@/lib/inbox/inbox-filters";
import {
  DEFAULT_SIGNATURE_TEMPLATE,
  MAX_SIGNATURE_TEMPLATE_LENGTH,
  appendSignature,
  renderSignature,
} from "@/lib/whatsapp/signature";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";
import { OwnershipCard } from "./ownership-card";

export function InboxSettings() {
  const { accountId, canEditSettings, profileLoading, profile, account } = useAuth();
  const t = useTranslations("Settings.inbox");
  const tList = useTranslations("Inbox.conversationList");
  const FILTER_LABELS: Record<InboxFilter, string> = {
    all: "filterAll",
    unread: "filterUnread",
    waiting: "filterWaiting",
    unassigned: "filterUnassigned",
    expiring: "filterExpiring",
    open: "filterOpen",
    pending: "filterPending",
    closed: "filterClosed",
    followup: "filterFollowup",
  };
  const tFilter = (value: InboxFilter) => tList(FILTER_LABELS[value]);
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Working window — the half of "response time" that decides whether the
  // number is fair. Off by default: nothing changes until this is switched on.
  const [hoursEnabled, setHoursEnabled] = useState(false);
  const [hoursStart, setHoursStart] = useState("09:00");
  const [hoursEnd, setHoursEnd] = useState("17:00");
  const [workDays, setWorkDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [savedHours, setSavedHours] = useState<string>("");
  const [savingHours, setSavingHours] = useState(false);

  // Which filter the Inbox opens on (migration 098).
  const [defaultFilter, setDefaultFilter] = useState<string>(DEFAULT_INBOX_FILTER);
  const [savedDefaultFilter, setSavedDefaultFilter] = useState<string>("");
  const [savingFilter, setSavingFilter] = useState(false);

  // Outgoing signature (migration 105). Off by default and the template
  // starts on the sender's own name — the two values the screen shows are
  // exactly what is stored, so an admin who turns it on and saves gets the
  // name without typing anything.
  const [signatureEnabled, setSignatureEnabled] = useState(false);
  const [signatureTemplate, setSignatureTemplate] = useState(DEFAULT_SIGNATURE_TEMPLATE);
  const [savedSignature, setSavedSignature] = useState<string>("");
  const [savingSignature, setSavingSignature] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    createClient()
      .from("accounts")
      .select(
        "reply_target_minutes, business_hours_enabled, business_hours_start, business_hours_end, business_days, default_inbox_filter, signature_enabled, signature_template",
      )
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          toast.error(t("loadFailed"));
          return;
        }
        setSaved(data.reply_target_minutes);
        setDraft(String(data.reply_target_minutes));

        const start = String(data.business_hours_start ?? "09:00").slice(0, 5);
        const end = String(data.business_hours_end ?? "17:00").slice(0, 5);
        const days = (data.business_days ?? [0, 1, 2, 3, 4]).map(Number);
        const chosen = String(data.default_inbox_filter ?? DEFAULT_INBOX_FILTER);
        setDefaultFilter(chosen);
        setSavedDefaultFilter(chosen);
        setHoursEnabled(Boolean(data.business_hours_enabled));
        setHoursStart(start);
        setHoursEnd(end);
        setWorkDays(days);
        setSavedHours(JSON.stringify([Boolean(data.business_hours_enabled), start, end, [...days].sort()]));

        // Signature (105). The stored template is shown as-is; the default
        // only fills the box when the column is missing on an older row.
        const signatureOn = data.signature_enabled === true;
        const signatureBody = data.signature_template ?? DEFAULT_SIGNATURE_TEMPLATE;
        setSignatureEnabled(signatureOn);
        setSignatureTemplate(signatureBody);
        setSavedSignature(JSON.stringify([signatureOn, signatureBody]));
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  const parsed = parseReplyTarget(draft);
  const dirty = parsed !== null && parsed !== saved;

  async function handleSave() {
    if (!accountId || parsed === null || !dirty) return;
    setSaving(true);
    const { error } = await createClient()
      .from("accounts")
      .update({ reply_target_minutes: parsed })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    setSaved(parsed);
    toast.success(t("saveSuccess"));
  }

  const hoursKey = JSON.stringify([hoursEnabled, hoursStart, hoursEnd, [...workDays].sort()]);
  const hoursDirty = savedHours !== "" && savedHours !== hoursKey;

  // A window the database would refuse (start >= end, no day selected) cannot
  // be saved: the constraint is real, so the button says so instead of
  // surfacing a 23514 halfway through a working day.
  const hoursValid =
    /^\d{2}:\d{2}$/.test(hoursStart) &&
    /^\d{2}:\d{2}$/.test(hoursEnd) &&
    hoursStart < hoursEnd &&
    workDays.length > 0;

  async function handleSaveHours() {
    if (!accountId || !hoursValid) return;
    setSavingHours(true);
    const { error } = await createClient()
      .from("accounts")
      .update({
        business_hours_enabled: hoursEnabled,
        business_hours_start: hoursStart,
        business_hours_end: hoursEnd,
        business_days: [...workDays].sort((a, b) => a - b),
      })
      .eq("id", accountId);
    setSavingHours(false);
    if (error) {
      toast.error(t("hoursSaveFailed"));
      return;
    }
    setSavedHours(JSON.stringify([hoursEnabled, hoursStart, hoursEnd, [...workDays].sort()]));
    toast.success(t("hoursSaved"));
  }

  async function handleSaveDefaultFilter(next: string) {
    if (!accountId) return;
    const previous = savedDefaultFilter;
    setDefaultFilter(next);
    setSavingFilter(true);
    const { error } = await createClient()
      .from("accounts")
      .update({ default_inbox_filter: next })
      .eq("id", accountId);
    setSavingFilter(false);
    if (error) {
      setDefaultFilter(previous);
      toast.error(t("saveFailed"));
      return;
    }
    setSavedDefaultFilter(next);
    toast.success(t("defaultFilterSaved"));
  }

  const signatureKey = JSON.stringify([signatureEnabled, signatureTemplate]);
  const signatureDirty = savedSignature !== "" && savedSignature !== signatureKey;
  const signatureBody = signatureTemplate.trim();

  async function handleSaveSignature() {
    if (!accountId || signatureBody === "") return;
    setSavingSignature(true);
    const { error } = await createClient()
      .from("accounts")
      .update({ signature_enabled: signatureEnabled, signature_template: signatureBody })
      .eq("id", accountId);
    setSavingSignature(false);
    if (error) {
      toast.error(t("signatureSaveFailed"));
      return;
    }
    setSignatureTemplate(signatureBody);
    setSavedSignature(JSON.stringify([signatureEnabled, signatureBody]));
    toast.success(t("signatureSaved"));
  }

  // Rendered with the signed-in teammate's own name so the preview answers
  // "what will my customer see", not an abstract sample.
  const previewSignature = renderSignature(signatureTemplate, {
    agentName: profile?.full_name ?? null,
    businessName: account?.name ?? null,
  });
  const previewBody = t("signaturePreviewBody");
  const previewText = signatureEnabled
    ? appendSignature(previewBody, previewSignature)
    : previewBody;

  function toggleDay(day: number) {
    setWorkDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  const disabled = !canEditSettings || profileLoading || saved === null;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Timer className="size-4 text-primary" />
            {t("replyTarget")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("replyTargetDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="reply-target" className="text-muted-foreground">
              {t("minutesLabel")}
            </Label>
            <Input
              id="reply-target"
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={disabled}
              aria-invalid={draft !== "" && parsed === null}
              aria-describedby="reply-target-hint"
            />
            <p id="reply-target-hint" className="text-xs text-muted-foreground">
              {draft !== "" && parsed === null
                ? t("invalid")
                : canEditSettings
                  ? t("hint")
                  : t("adminOnlyHint")}
            </p>
          </div>

          {canEditSettings && (
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ---------- default filter ---------- */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <ListFilter className="size-4 text-primary" />
            {t("defaultFilterTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("defaultFilterDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="default-filter" className="text-muted-foreground">
              {t("defaultFilterLabel")}
            </Label>
            <select
              id="default-filter"
              value={defaultFilter}
              disabled={!canEditSettings || savingFilter}
              onChange={(e) => void handleSaveDefaultFilter(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none disabled:opacity-60"
            >
              {INBOX_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {tFilter(value)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {savingFilter
                ? t("saving")
                : canEditSettings
                  ? t("defaultFilterHint")
                  : t("adminOnlyHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---------- working hours ---------- */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <CalendarClock className="size-4 text-primary" />
            {t("hoursTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("hoursDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={hoursEnabled}
              onChange={(e) => setHoursEnabled(e.target.checked)}
              disabled={!canEditSettings}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="text-sm text-foreground">
              {t("hoursEnable")}
              <span className="text-muted-foreground block text-xs">
                {t("hoursEnableHint")}
              </span>
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2 sm:max-w-sm">
            <div className="grid gap-2">
              <Label htmlFor="hours-from" className="text-muted-foreground">
                {t("hoursFrom")}
              </Label>
              <Input
                id="hours-from"
                type="time"
                value={hoursStart}
                onChange={(e) => setHoursStart(e.target.value)}
                disabled={!canEditSettings || !hoursEnabled}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hours-to" className="text-muted-foreground">
                {t("hoursTo")}
              </Label>
              <Input
                id="hours-to"
                type="time"
                value={hoursEnd}
                onChange={(e) => setHoursEnd(e.target.value)}
                disabled={!canEditSettings || !hoursEnabled}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("daysLabel")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                const active = workDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    disabled={!canEditSettings || !hoursEnabled}
                    aria-pressed={active}
                    className={
                      "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 " +
                      (active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground")
                    }
                  >
                    {t(`day${day}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {!hoursValid
              ? t("hoursInvalid")
              : canEditSettings
                ? t("hoursHint")
                : t("adminOnlyHint")}
          </p>

          {canEditSettings && (
            <Button
              onClick={handleSaveHours}
              disabled={savingHours || !hoursDirty || !hoursValid}
            >
              {savingHours ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          )}
        </CardContent>
      </Card>
      {/* ---------- outgoing signature ---------- */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <PenLine className="size-4 text-primary" />
            {t("signatureTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("signatureDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="signature-enabled" className="text-foreground">
                {t("signatureEnable")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("signatureEnableHint")}
              </p>
            </div>
            <Switch
              id="signature-enabled"
              checked={signatureEnabled}
              onCheckedChange={setSignatureEnabled}
              disabled={!canEditSettings}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="signature-template" className="text-muted-foreground">
              {t("signatureTemplateLabel")}
            </Label>
            <Textarea
              id="signature-template"
              value={signatureTemplate}
              onChange={(e) => setSignatureTemplate(e.target.value)}
              placeholder="{{ agent_name }}"
              rows={3}
              maxLength={MAX_SIGNATURE_TEMPLATE_LENGTH}
              dir="auto"
              disabled={!canEditSettings || !signatureEnabled}
              className="font-mono text-sm"
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  {"{{ agent_name }}"}
                </code>
                {t("signatureAgentNameHint")}
              </span>
              <span className="inline-flex items-center gap-1">
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  {"{{ business_name }}"}
                </code>
                {t("signatureBusinessHint")}
              </span>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-muted-foreground">{t("signaturePreview")}</Label>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="whitespace-pre-line text-sm text-foreground">
                {previewText}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {!canEditSettings
              ? t("adminOnlyHint")
              : signatureBody === ""
                ? t("signatureEmptyWarning")
                : t("signatureHint")}
          </p>

          {canEditSettings && (
            <Button
              onClick={handleSaveSignature}
              disabled={savingSignature || !signatureDirty || signatureBody === ""}
            >
              {savingSignature ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <OwnershipCard />
    </section>
  );
}
