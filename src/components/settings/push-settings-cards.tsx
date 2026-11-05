"use client";

/**
 * The two cards that make the privacy promise real, plus the device list.
 *
 * Privacy is a first-class choice, not a footnote: `none` hides both the name
 * and the text, `name` (the default) is useful on a shared desk, `full` is for
 * a phone that lives in a pocket. Quiet hours suppress PUSH only — the in-app
 * popup keeps working for whoever is at the desk at 23:00.
 *
 * The devices card answers "why did my phone stop?" without a support ticket:
 * every subscription is listed with its last-seen time, and one that keeps
 * failing is flagged in place. Removing one is immediate.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Moon, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreferences, PushPreview } from "@/lib/push/preferences";

const PREVIEW_MODES: PushPreview[] = ["none", "name", "full"];

interface PrivacyCardProps {
  prefs: NotificationPreferences;
  loading: boolean;
  onSave: (patch: Partial<NotificationPreferences>) => Promise<void>;
}

export function PushPrivacyCard({ prefs, loading, onSave }: PrivacyCardProps) {
  const t = useTranslations("Settings.notifications.privacy");
  const quietOn = Boolean(prefs.quiet_from && prefs.quiet_to);
  const [from, setFrom] = useState(prefs.quiet_from ?? "22:00");
  const [to, setTo] = useState(prefs.quiet_to ?? "07:00");

  // Keep the inputs in sync when the saved row arrives after mount.
  useEffect(() => {
    if (prefs.quiet_from) setFrom(prefs.quiet_from);
    if (prefs.quiet_to) setTo(prefs.quiet_to);
  }, [prefs.quiet_from, prefs.quiet_to]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label className="text-sm font-medium text-foreground">{t("previewLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            {PREVIEW_MODES.map((mode) => {
              const active = prefs.push_preview === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={loading}
                  onClick={() => void onSave({ push_preview: mode })}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`preview_${mode}`)}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t("previewHint")}</p>
        </div>

        <div className="border-t border-border pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Moon className="size-4 text-muted-foreground" />
                {t("quietLabel")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("quietHint")}</p>
            </div>
            <Switch
              checked={quietOn}
              disabled={loading}
              aria-label={t("quietLabel")}
              onCheckedChange={(next) =>
                void onSave(
                  next ? { quiet_from: from, quiet_to: to } : { quiet_from: null, quiet_to: null },
                )
              }
            />
          </div>

          {quietOn && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <Label htmlFor="quiet-from" className="text-xs text-muted-foreground">
                  {t("from")}
                </Label>
                <input
                  id="quiet-from"
                  type="time"
                  value={from}
                  disabled={loading}
                  onChange={(e) => setFrom(e.target.value)}
                  onBlur={() => void onSave({ quiet_from: from, quiet_to: to })}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="quiet-to" className="text-xs text-muted-foreground">
                  {t("to")}
                </Label>
                <input
                  id="quiet-to"
                  type="time"
                  value={to}
                  disabled={loading}
                  onChange={(e) => setTo(e.target.value)}
                  onBlur={() => void onSave({ quiet_from: from, quiet_to: to })}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface DeviceRow {
  id: string;
  locale: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  failures: number;
  last_error: string | null;
}

export function PushDevicesCard() {
  const t = useTranslations("Settings.notifications.devices");
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/push/devices", { cache: "no-store" });
      const body = (await res.json()) as { devices?: DeviceRow[] };
      setDevices(body.devices ?? []);
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/push/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("delete_failed");
      setDevices((prev) => prev.filter((d) => d.id !== id));
      toast.success(t("removed"));
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Smartphone className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t("loading")}
          </div>
        )}

        {!loading && devices.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("empty")}</p>
        )}

        {devices.map((device) => {
          const failing = device.failures > 0 || Boolean(device.last_error);
          return (
            <div
              key={device.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {device.user_agent || t("unknownDevice")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("lastSeen")}: {new Date(device.last_seen_at).toLocaleString()}
                  {device.locale === "en" ? " · EN" : " · AR"}
                </p>
                {failing && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {t("failing")}
                    {device.last_error ? ` — ${device.last_error.slice(0, 80)}` : ""}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy === device.id}
                onClick={() => void remove(device.id)}
                aria-label={t("remove")}
              >
                {busy === device.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </CardContent>
    </Card>
  );
}
