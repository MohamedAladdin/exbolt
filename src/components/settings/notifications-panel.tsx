"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, MonitorSmartphone, Send, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { SettingsPanelHead } from "./settings-panel-head";
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
import {
  currentLocale,
  currentPermission,
  disablePush,
  enablePush,
  getExistingSubscription,
  pushSupported,
  sendTestPush,
  PUSH_CHANGE_EVENT,
  type PushFailure,
  type PushPermissionState,
} from "@/hooks/use-push";
import {
  DEFAULT_PREFERENCES,
  TYPE_KEYS,
  CHANNEL_KEYS,
  type ChannelKey,
  type NotificationPreferences,
  type TypeKey,
} from "@/lib/push/preferences";
import { playNotificationChime, writeSoundPref } from "@/lib/notifications/sound";

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

  const soundOn = useNotificationSoundPref();
  const [permission, setPermission] = useState<PushPermissionState>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshDevice = useCallback(async () => {
    setPermission(currentPermission());
    setSubscribed(Boolean(await getExistingSubscription()));
  }, []);

  useEffect(() => {
    void refreshDevice();
    // Enabling from the first-run prompt (or another tab) must move this switch
    // too — otherwise the panel keeps saying «مقفولة» on a device that is live.
    const onChange = () => void refreshDevice();
    window.addEventListener(PUSH_CHANGE_EVENT, onChange);
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onChange);
    return () => {
      window.removeEventListener(PUSH_CHANGE_EVENT, onChange);
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [refreshDevice]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/push/preferences", { credentials: "include" });
        const body = (await res.json()) as { preferences?: NotificationPreferences };
        if (!cancelled && body.preferences) setPrefs(body.preferences);
      } catch {
        // The defaults are what a fresh user sees anyway.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const failureMessage = useCallback(
    (reason?: PushFailure) => {
      switch (reason) {
        case "not_configured":
          return tDevice("notConfigured");
        case "too_many_devices":
          return tDevice("tooManyDevices");
        case "denied":
          return tDevice("stateDeniedHint");
        case "no_device":
          return tDevice("noDevice");
        case "unsupported":
          return tDevice("stateUnsupported");
        default:
          return tDevice("failed");
      }
    },
    [tDevice],
  );

  const onToggleDevice = async (next: boolean) => {
    setBusy("device");
    try {
      const result = next ? await enablePush(currentLocale()) : await disablePush();
      if (!result.ok) {
        toast.error(failureMessage(result.reason));
        return;
      }
      await refreshDevice();
      toast.success(next ? tDevice("enabledToast") : tDevice("disabledToast"));
    } finally {
      setBusy(null);
    }
  };

  const onSendTest = async () => {
    setBusy("test");
    try {
      const result = await sendTestPush(currentLocale());
      if (result.ok) {
        toast.success(tDevice("testSent"));
        return;
      }
      toast.error(failureMessage(result.reason));
    } finally {
      setBusy(null);
    }
  };

  const savePrefs = async (patch: Partial<NotificationPreferences>) => {
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    setBusy("prefs");
    try {
      const res = await fetch("/api/push/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setPrefs(before);
        toast.error(t("saveFailed"));
      }
    } catch {
      setPrefs(before);
      toast.error(t("saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const deviceState = !pushSupported()
    ? tDevice("stateUnsupported")
    : permission === "denied"
      ? tDevice("stateDenied")
      : subscribed
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
              {busy === "device" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={subscribed && permission === "granted"}
                onCheckedChange={(next) => void onToggleDevice(next)}
                disabled={busy === "device" || !pushSupported() || permission === "denied"}
                aria-label={tDevice("toggleLabel")}
              />
            </div>
          </div>

          {permission === "denied" && (
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
            disabled={busy === "test" || !subscribed}
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
                disabled={loading || busy === "prefs"}
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
                disabled={loading || busy === "prefs"}
                aria-label={tTypes(key)}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{tTypes("recordNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
