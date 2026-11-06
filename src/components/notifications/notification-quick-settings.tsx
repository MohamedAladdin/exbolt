"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Loader2, Settings2, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { useNotificationSoundPref } from "@/hooks/use-browser-notifications";
import { usePushDevice } from "@/hooks/use-push-device";
import {
  NOTIFICATIONS_SETTINGS_HREF,
  QUICK_TYPE_KEYS,
} from "@/lib/notifications/quick-settings";
import { playNotificationChime, writeSoundPref } from "@/lib/notifications/sound";
import { pushFailureMessageKey } from "@/lib/push/failure";
import type { TypeKey } from "@/lib/push/preferences";
import { cn } from "@/lib/utils";

/**
 * The six switches an operator reaches for *while* reading their alerts — this
 * device, the chime, and one per notification type — plus the way out to the rest.
 *
 * The split is deliberate: these are the answer to «شكل التنبيه ده مزعجني، أوقفه
 * دلوقتي», which has to happen on the page that shows the pile. Everything that
 * needs an explanation (channels, privacy on the lock screen, quiet hours, the
 * device list, the team roster) stays in Settings → الإشعارات behind one button,
 * rather than being copied here as a second, drifting copy.
 *
 * The card renders above the list and the empty state alike: a brand-new member has
 * no alerts yet and is exactly the person who should be setting this up.
 */
export function NotificationQuickSettings() {
  const t = useTranslations("Notifications.quick");
  const tSettings = useTranslations("Settings.notifications");
  const tDevice = useTranslations("Settings.notifications.device");
  const tTypes = useTranslations("Settings.notifications.types");

  const device = usePushDevice();
  const { prefs, loading, saving, save } = useNotificationPreferences();
  const soundOn = useNotificationSoundPref();
  // On a phone six switch rows push the list itself below the fold, so the card
  // starts folded there and stays open on a desktop. CSS decides which of the two
  // applies (`sm:grid`), so no viewport read is needed at render time.
  const [open, setOpen] = useState(false);

  const deviceState = !device.supported
    ? tDevice("stateUnsupported")
    : device.permission === "denied"
      ? tDevice("stateDenied")
      : device.subscribed
        ? tDevice("stateEnabled")
        : tDevice("stateOff");

  const onToggleDevice = async (next: boolean) => {
    const failure = await device.toggle(next);
    if (failure) {
      toast.error(tDevice(pushFailureMessageKey(failure)));
      return;
    }
    toast.success(next ? tDevice("enabledToast") : tDevice("disabledToast"));
  };

  const onToggleType = async (key: TypeKey, next: boolean) => {
    if (!(await save({ [key]: next }))) toast.error(tSettings("saveFailed"));
  };

  return (
    <section
      aria-label={t("title")}
      className="rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <SlidersHorizontal
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            {t("title")}
          </p>
          <p className="mt-1 max-w-[70ch] text-xs text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <Link
          href={NOTIFICATIONS_SETTINGS_HREF}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "shrink-0",
          )}
        >
          <Settings2 className="size-3.5" aria-hidden />
          {t("openSettings")}
        </Link>
      </div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="notification-quick-toggles"
        className="flex w-full items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-start text-xs font-medium text-muted-foreground sm:hidden"
      >
        {open ? t("hideToggles") : t("showToggles")}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div
        id="notification-quick-toggles"
        className={cn(
          "grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3",
          !open && "hidden sm:grid",
        )}
      >
        {/* 1 — this device. The hint is the browser's own state, not a saved flag. */}
        <QuickRow
          label={t("device")}
          hint={deviceState}
          checked={device.subscribed && device.permission === "granted"}
          disabled={
            !device.supported ||
            device.permission === "denied" ||
            device.busy
          }
          busy={device.busy}
          onChange={(next) => void onToggleDevice(next)}
        />

        {/* 2 — the chime is a device preference, so it sits beside the device. */}
        <QuickRow
          label={t("sound")}
          checked={soundOn}
          onChange={(next) => {
            writeSoundPref(next);
            if (next) playNotificationChime();
          }}
        />

        {/* 3–6 — one per type. A switch here means every channel for that type. */}
        {QUICK_TYPE_KEYS.map((key) => (
          <QuickRow
            key={key}
            label={tTypes(key)}
            checked={prefs[key]}
            disabled={loading || saving}
            onChange={(next) => void onToggleType(key, next)}
          />
        ))}
      </div>

      {device.permission === "denied" && (
        <p className="mx-4 mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {tDevice("stateDeniedHint")}
        </p>
      )}
    </section>
  );
}

function QuickRow({
  label,
  hint,
  checked,
  disabled,
  busy,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        {hint && (
          <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {busy && (
          <Loader2
            className="size-3.5 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-label={label}
        />
      </div>
    </div>
  );
}
