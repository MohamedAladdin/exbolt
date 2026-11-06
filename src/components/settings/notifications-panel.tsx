"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, MonitorSmartphone, Send, Users, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { SettingsPanelHead } from "./settings-panel-head";
import { PushDevicesCard, PushPrivacyCard } from "./push-settings-cards";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useNotificationSoundPref } from "@/hooks/use-browser-notifications";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { usePushDevice } from "@/hooks/use-push-device";
import { currentLocale, sendTestPush } from "@/hooks/use-push";
import {
  CHANNEL_KEYS,
  TYPE_KEYS,
  type ChannelKey,
  type NotificationPreferences,
  type TypeKey,
} from "@/lib/push/preferences";
import { pushFailureMessageKey } from "@/lib/push/failure";
import { playNotificationChime, writeSoundPref } from "@/lib/notifications/sound";
import { useAuth } from "@/hooks/use-auth";
import type { PushStatusSummary } from "@/lib/push/status";

/**
 * Settings → الإشعارات.
 *
 * Two ideas hold this screen together:
 *
 *   1. **A channel is not a type.** «أين يوصل التنبيه» (in-app / push) and «أي
 *      تنبيهات أريد» are different questions, so they are different blocks. All
 *      four type switches gate *every* channel: switching "رسالة عميل جديدة" off
 *      must stop the popup, the desktop alert and the phone, not just one of them.
 *   2. **The screen tells the truth about this device.** The enable switch reads
 *      its state from the browser (permission + a live subscription), never from a
 *      saved flag — a device that the browser has blocked must not look "on".
 *
 * The `notifications` record itself is not switchable anywhere: turning everything
 * off leaves a complete history in /notifications.
 */
export function NotificationsPanel() {
  const t = useTranslations("Settings.notifications");
  const tDevice = useTranslations("Settings.notifications.device");
  const tChannels = useTranslations("Settings.notifications.channels");
  const tTypes = useTranslations("Settings.notifications.types");
  const tTeam = useTranslations("Settings.notifications.team");

  const soundOn = useNotificationSoundPref();
  const device = usePushDevice();
  const { prefs, loading, saving, save } = useNotificationPreferences();
  const [busy, setBusy] = useState<string | null>(null);
  const { canManageMembers } = useAuth();
  const [team, setTeam] = useState<PushStatusSummary | null>(null);

  // Admin view: who on this team can actually receive an alert. Refetched after any
  // change on this device, because this device is one of the rows.
  const refreshTeam = useCallback(async () => {
    if (!canManageMembers) return;
    try {
      const res = await fetch("/api/push/status", { credentials: "include" });
      if (!res.ok) return;
      setTeam((await res.json()) as PushStatusSummary);
    } catch {
      // Not fatal: the panel's own state is still truthful.
    }
  }, [canManageMembers]);

  useEffect(() => {
    void refreshTeam();
  }, [refreshTeam]);

  const onToggleDevice = async (next: boolean) => {
    const failure = await device.toggle(next);
    if (failure) {
      toast.error(tDevice(pushFailureMessageKey(failure)));
      return;
    }
    void refreshTeam();
    toast.success(next ? tDevice("enabledToast") : tDevice("disabledToast"));
  };

  const onSendTest = async () => {
    setBusy("test");
    try {
      const result = await sendTestPush(currentLocale());
      if (result.ok) {
        toast.success(tDevice("testSent"));
        return;
      }
      toast.error(tDevice(pushFailureMessageKey(result.reason)));
    } finally {
      setBusy(null);
    }
  };

  const savePrefs = async (patch: Partial<NotificationPreferences>) => {
    if (!(await save(patch))) toast.error(t("saveFailed"));
  };

  const deviceState = !device.supported
    ? tDevice("stateUnsupported")
    : device.permission === "denied"
      ? tDevice("stateDenied")
      : device.subscribed
        ? tDevice("stateEnabled")
        : tDevice("stateOff");

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {/* 1 — this device */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <MonitorSmartphone className="size-4 text-muted-foreground" />
            {tDevice("title")}
          </CardTitle>
          <CardDescription>{tDevice("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{tDevice("toggleLabel")}</p>
              <p className="text-xs text-muted-foreground">{deviceState}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {device.busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={device.subscribed && device.permission === "granted"}
                onCheckedChange={(next) => void onToggleDevice(next)}
                disabled={device.busy || !device.supported || device.permission === "denied"}
                aria-label={tDevice("toggleLabel")}
              />
            </div>
          </div>

          {device.permission === "denied" && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {tDevice("stateDeniedHint")}
            </p>
          )}

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{tDevice("soundLabel")}</p>
              <p className="text-xs text-muted-foreground">{tDevice("soundDesc")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Volume2 className="size-4 text-muted-foreground" aria-hidden />
              <Switch
                checked={soundOn}
                onCheckedChange={(next) => {
                  writeSoundPref(next);
                  if (next) playNotificationChime();
                }}
                aria-label={tDevice("soundLabel")}
              />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onSendTest()}
            disabled={busy === "test" || !device.subscribed}
          >
            {busy === "test" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {tDevice("sendTest")}
          </Button>
          <p className="text-xs text-muted-foreground">{tDevice("installHint")}</p>
        </CardContent>
      </Card>

      {/* 2 — channels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <BellRing className="size-4 text-muted-foreground" />
            {tChannels("title")}
          </CardTitle>
          <CardDescription>{tChannels("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {CHANNEL_KEYS.map((key: ChannelKey) => (
            <div
              key={key}
              className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{tChannels(key)}</p>
                <p className="text-xs text-muted-foreground">{tChannels(`${key}Desc`)}</p>
              </div>
              <Switch
                checked={prefs[key]}
                onCheckedChange={(next) => void savePrefs({ [key]: next })}
                disabled={loading || saving}
                aria-label={tChannels(key)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 3 — types */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <BellRing className="size-4 text-muted-foreground" />
            {tTypes("title")}
          </CardTitle>
          <CardDescription>{tTypes("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TYPE_KEYS.map((key: TypeKey) => (
            <div
              key={key}
              className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{tTypes(key)}</p>
                <p className="text-xs text-muted-foreground">{tTypes(`${key}Desc`)}</p>
              </div>
              <Switch
                checked={prefs[key]}
                onCheckedChange={(next) => void savePrefs({ [key]: next })}
                disabled={loading || saving}
                aria-label={tTypes(key)}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{tTypes("recordNote")}</p>
        </CardContent>
      </Card>

      {/* 4 + 5 — privacy and quiet hours */}
      <PushPrivacyCard prefs={prefs} loading={loading} onSave={savePrefs} />

      {/* 6 — devices */}
      <PushDevicesCard />

      {/* 7 — the team (admin+): who can actually receive an alert */}
      {canManageMembers && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Users className="size-4 text-muted-foreground" />
              {tTeam("title")}
            </CardTitle>
            <CardDescription>
              {team
                ? tTeam("summary", { reachable: team.reachable, total: team.total })
                : tTeam("loading")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {team?.members.map((member) => (
              <div
                key={member.user_id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tTeam(
                      `roles.${member.role}` as
                        | "roles.owner"
                        | "roles.admin"
                        | "roles.agent"
                        | "roles.viewer",
                    )}
                    {member.devices > 0 && ` · ${tTeam("devices", { count: member.devices })}`}
                  </p>
                </div>
                <span
                  className={
                    member.reachable
                      ? "shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                      : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                  }
                >
                  {member.reachable
                    ? tTeam("on")
                    : member.devices > 0
                      ? tTeam("muted")
                      : tTeam("off")}
                </span>
              </div>
            ))}
            {team && team.members.length === 0 && (
              <p className="text-xs text-muted-foreground">{tTeam("empty")}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
