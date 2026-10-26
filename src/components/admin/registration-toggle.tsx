'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Lock, LockOpen } from 'lucide-react';

import { adminPatch } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';

export function RegistrationToggle({
  enabled,
  mode,
}: {
  enabled: boolean;
  mode: string;
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const flip = async () => {
    setBusy(true);
    try {
      await adminPatch('/api/admin/settings', {
        signupEnabled: !enabled,
        // Turning it back on means "open", otherwise a leftover
        // invite-only mode would keep the door shut and look broken.
        ...(enabled ? {} : { signupMode: 'open' }),
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
    <div className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={
            enabled
              ? 'flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500'
              : 'flex size-9 items-center justify-center rounded-lg bg-red-500/10 text-red-500'
          }
        >
          {enabled ? (
            <LockOpen className="size-4" />
          ) : (
            <Lock className="size-4" />
          )}
        </span>
        <div>
          <div className="text-foreground text-sm font-medium">
            {t('overview.registration')}:{' '}
            <span className={enabled ? 'text-emerald-500' : 'text-red-500'}>
              {enabled
                ? t('overview.registrationOn')
                : t('overview.registrationOff')}
            </span>
            {mode === 'invite_only' ? (
              <span className="text-muted-foreground ms-2 text-xs">
                ({t('settings.mode.invite_only')})
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {t('overview.registrationHint')}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={flip}
        disabled={busy}
        className="border-border text-foreground hover:bg-muted inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50"
      >
        {busy
          ? t('working')
          : enabled
            ? t('overview.turnOff')
            : t('overview.turnOn')}
      </button>
    </div>
  );
}
