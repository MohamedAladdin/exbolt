'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2, UserPlus } from 'lucide-react';

import type { SettingsRow } from '@/lib/admin/queries';
import { adminPatch, adminRequest } from '@/lib/admin/client';
import { adminErrorText, adminT } from '@/lib/admin/copy';
import { formatDate } from '@/lib/admin/format';
import {
  Chip,
  DataTable,
  EmptyRow,
  TD,
  TH,
  THead,
} from '@/components/admin/ui';

const inputClass =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none';

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-muted-foreground text-[11px]">{hint}</span>
      ) : null}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="text-foreground flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="border-border size-4 rounded"
      />
      {label}
    </label>
  );
}

export function SettingsForm({ settings }: { settings: SettingsRow }) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    signupEnabled: settings.signupEnabled,
    signupMode: settings.signupMode,
    signupClosedMessage: settings.signupClosedMessage ?? '',
    maintenanceMode: settings.maintenanceMode,
    maintenanceMessage: settings.maintenanceMessage ?? '',
    billingFromName: settings.billingFromName,
    billingFromEmail: settings.billingFromEmail ?? '',
    billingReplyTo: settings.billingReplyTo ?? '',
    supportEmail: settings.supportEmail ?? '',
    reminderDaysBefore: String(settings.reminderDaysBefore),
    graceDays: String(settings.graceDays),
    currency: settings.currency,
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      await adminPatch('/api/admin/settings', {
        ...form,
        reminderDaysBefore: Number(form.reminderDaysBefore) || 0,
        graceDays: Number(form.graceDays) || 0,
        billingFromEmail: form.billingFromEmail || null,
        billingReplyTo: form.billingReplyTo || null,
        supportEmail: form.supportEmail || null,
        signupClosedMessage: form.signupClosedMessage || null,
        maintenanceMessage: form.maintenanceMessage || null,
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
    <div className="flex flex-col gap-4">
      <section className="border-border bg-card rounded-xl border">
        <header className="border-border border-b px-4 py-3">
          <h2 className="text-foreground text-sm font-semibold">
            {t('settings.registration.title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('settings.registration.desc')}
          </p>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Toggle
              label={t('settings.signupEnabled')}
              checked={form.signupEnabled}
              onChange={(value) => set('signupEnabled', value)}
            />
            <Field label={t('settings.mode')}>
              <select
                value={form.signupMode}
                onChange={(event) =>
                  set(
                    'signupMode',
                    event.target.value as SettingsRow['signupMode']
                  )
                }
                className={inputClass}
              >
                <option value="open">{t('settings.mode.open')}</option>
                <option value="invite_only">
                  {t('settings.mode.invite_only')}
                </option>
                <option value="closed">{t('settings.mode.closed')}</option>
              </select>
            </Field>
          </div>
          <Field label={t('settings.closedMessage')}>
            <input
              value={form.signupClosedMessage}
              onChange={(event) =>
                set('signupClosedMessage', event.target.value)
              }
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <section className="border-border bg-card rounded-xl border">
        <header className="border-border border-b px-4 py-3">
          <h2 className="text-foreground text-sm font-semibold">
            {t('settings.maintenance.title')}
          </h2>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Toggle
            label={t('settings.maintenance.enabled')}
            checked={form.maintenanceMode}
            onChange={(value) => set('maintenanceMode', value)}
          />
          <Field label={t('settings.maintenance.message')}>
            <input
              value={form.maintenanceMessage}
              onChange={(event) =>
                set('maintenanceMessage', event.target.value)
              }
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <section className="border-border bg-card rounded-xl border">
        <header className="border-border border-b px-4 py-3">
          <h2 className="text-foreground text-sm font-semibold">
            {t('settings.mail.title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('settings.mail.hint')}
          </p>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label={t('settings.mail.fromName')}>
            <input
              value={form.billingFromName}
              onChange={(e) => set('billingFromName', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('settings.mail.fromEmail')}>
            <input
              type="email"
              value={form.billingFromEmail}
              onChange={(e) => set('billingFromEmail', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('settings.mail.replyTo')}>
            <input
              type="email"
              value={form.billingReplyTo}
              onChange={(e) => set('billingReplyTo', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('settings.mail.support')}>
            <input
              type="email"
              value={form.supportEmail}
              onChange={(e) => set('supportEmail', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <section className="border-border bg-card rounded-xl border">
        <header className="border-border border-b px-4 py-3">
          <h2 className="text-foreground text-sm font-semibold">
            {t('settings.policy.title')}
          </h2>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label={t('settings.policy.daysBefore')}>
            <input
              type="number"
              min={0}
              value={form.reminderDaysBefore}
              onChange={(e) => set('reminderDaysBefore', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('settings.policy.grace')}>
            <input
              type="number"
              min={0}
              value={form.graceDays}
              onChange={(e) => set('graceDays', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t('settings.policy.currency')}>
            <input
              value={form.currency}
              onChange={(e) =>
                set('currency', e.target.value.toUpperCase().slice(0, 3))
              }
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <div>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="bg-foreground text-background inline-flex h-9 items-center rounded-md px-4 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}

export function AdminsPanel({
  admins,
  currentEmail,
}: {
  admins: {
    userId: string;
    email: string;
    note: string | null;
    createdAt: string;
  }[];
  currentEmail: string;
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await adminRequest('/api/admin/settings', body);
      toast.success(t('done'));
      setEmail('');
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('settings.admins.email')}
          className={`${inputClass} max-w-72`}
          type="email"
        />
        <button
          type="button"
          onClick={() => call({ action: 'add_admin', email })}
          disabled={busy || !email.includes('@')}
          className="border-border text-foreground hover:bg-muted inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium disabled:opacity-50"
        >
          <UserPlus className="size-3.5" />
          {t('settings.admins.add')}
        </button>
      </div>

      <DataTable>
        <THead>
          <TH>{t('settings.admins.email')}</TH>
          <TH>{t('settings.admins.note')}</TH>
          <TH className="text-end">{t('actions')}</TH>
        </THead>
        <tbody>
          {admins.length === 0 ? (
            <EmptyRow colSpan={3}>{t('empty')}</EmptyRow>
          ) : (
            admins.map((admin) => (
              <tr
                key={admin.userId}
                className="border-border/60 border-b last:border-0"
              >
                <TD>
                  <span className="text-foreground text-sm">{admin.email}</span>
                  {admin.email === currentEmail ? (
                    <span className="text-muted-foreground ms-2 text-[11px]">
                      ({t('settings.admins.you')})
                    </span>
                  ) : null}
                </TD>
                <TD className="text-muted-foreground text-xs">
                  {admin.note ?? formatDate(admin.createdAt)}
                </TD>
                <TD className="text-end">
                  <button
                    type="button"
                    onClick={() =>
                      call({ action: 'remove_admin', userId: admin.userId })
                    }
                    disabled={busy || admin.email === currentEmail}
                    className="border-border text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] disabled:opacity-30"
                  >
                    <Trash2 className="size-3" />
                    {t('settings.admins.remove')}
                  </button>
                </TD>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </div>
  );
}

export function AllowlistPanel({
  rows,
}: {
  rows: {
    email: string;
    note: string | null;
    createdAt: string;
    expiresAt: string | null;
    usedAt: string | null;
  }[];
}) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await adminRequest('/api/admin/settings', body);
      toast.success(t('done'));
      setEmail('');
      router.refresh();
    } catch (err) {
      toast.error(adminErrorText(locale, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('settings.allowlist.email')}
          className={`${inputClass} max-w-72`}
          type="email"
        />
        <button
          type="button"
          onClick={() => call({ action: 'allow', email })}
          disabled={busy || !email.includes('@')}
          className="border-border text-foreground hover:bg-muted inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium disabled:opacity-50"
        >
          {t('settings.allowlist.add')}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('settings.allowlist.empty')}
        </p>
      ) : (
        <ul className="divide-border/60 flex flex-col divide-y">
          {rows.map((row) => (
            <li
              key={row.email}
              className="flex items-center gap-2 py-1.5 text-sm"
            >
              <span className="text-foreground truncate">{row.email}</span>
              <Chip tone={row.usedAt ? 'neutral' : 'ok'}>
                {row.usedAt
                  ? t('settings.allowlist.used')
                  : t('settings.allowlist.pending')}
              </Chip>
              <button
                type="button"
                onClick={() => call({ action: 'unallow', email: row.email })}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground ms-auto disabled:opacity-50"
                aria-label={t('cancel')}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
