'use client';

import { useState } from 'react';
import { BellRing, CircleAlert, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useNotificationSoundPref } from '@/hooks/use-browser-notifications';
import { usePushDevice } from '@/hooks/use-push-device';
import { currentLocale, sendTestPush } from '@/hooks/use-push';
import { pushFailureMessageKey } from '@/lib/push/failure';
import {
  playNotificationChime,
  unlockNotificationAudio,
  writeSoundPref,
} from '@/lib/notifications/sound';

/**
 * "Browser notifications" — this device's switch, on the profile tab.
 *
 * It used to keep its own opt-in in localStorage and draw the banners itself, so
 * it was a second, unconnected switch: the preferences page could not turn it off,
 * it stopped at the tab (a closed browser was silent) and once Web Push shipped the
 * same message could raise two banners.
 *
 * It is now the SAME switch as Settings → الإشعارات (`usePushDevice`): one push
 * subscription per device, which is also what the notification page's quick card
 * shows. Turning it off unsubscribes the browser and clears what is on screen, so
 * «قفلت الإشعارات» finally means silence everywhere.
 */
export function BrowserNotificationsCard({ className }: { className?: string }) {
  const t = useTranslations('Settings.browserNotifications');
  const tDevice = useTranslations('Settings.notifications.device');
  const device = usePushDevice();
  const soundOn = useNotificationSoundPref();
  const [busy, setBusy] = useState(false);

  const checked = device.subscribed && device.permission === 'granted';

  const onToggle = async (next: boolean) => {
    const failure = await device.toggle(next);
    if (failure) {
      toast.error(tDevice(pushFailureMessageKey(failure)));
      return;
    }
    toast.success(next ? tDevice('enabledToast') : tDevice('disabledToast'));
  };

  const sendTest = async () => {
    // The click is the gesture that unlocks audio. The context resumes
    // asynchronously, so the chime is asked for a beat later — otherwise the very
    // first test on a fresh tab would be silent.
    unlockNotificationAudio();
    window.setTimeout(() => playNotificationChime(), 150);
    setBusy(true);
    try {
      const result = await sendTestPush(currentLocale());
      if (result.ok) {
        toast.success(tDevice('testSent'));
        return;
      }
      toast.error(tDevice(pushFailureMessageKey(result.reason)));
    } finally {
      setBusy(false);
    }
  };

  const statusKey = !device.supported
    ? 'unsupported'
    : device.permission === 'denied'
      ? 'statusDenied'
      : checked
        ? 'statusGranted'
        : 'statusDefault';

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <BellRing className="size-4 text-muted-foreground" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t('toggleLabel')}</p>
            <p className="text-xs text-muted-foreground">{t('toggleDesc')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {device.busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            <Switch
              checked={checked}
              onCheckedChange={(next) => void onToggle(next)}
              disabled={device.busy || !device.supported || device.permission === 'denied'}
              aria-label={t('toggleLabel')}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t(statusKey)}</p>

        {/* Sound is its own device preference: muting the chime must not mute the
            alerts, and a muted OS must not make the product silent. */}
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t('soundLabel')}</p>
            <p className="text-xs text-muted-foreground">{t('soundDesc')}</p>
          </div>
          <Switch
            checked={soundOn}
            onCheckedChange={(next) => {
              writeSoundPref(next);
              if (next) playNotificationChime();
            }}
            aria-label={t('soundLabel')}
          />
        </div>

        {device.permission === 'denied' && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{t('deniedHint')}</span>
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void sendTest()}
          disabled={busy || !checked}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
          {t('sendTest')}
        </Button>
      </CardContent>
    </Card>
  );
}
