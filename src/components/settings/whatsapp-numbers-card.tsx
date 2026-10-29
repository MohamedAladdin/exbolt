'use client';

// ============================================================
// Multi-number settings card (migration 075/076).
//
// Lists every WhatsApp number on the account and adds a new one
// through the SAME manual credentials path that has always existed
// (phone_number_id + token + optional PIN). It deliberately does not
// reuse the big form below: that one edits the default number and
// insists on re-entering the access token, which is a silly toll
// when all you want is "connect the second number".
//
// The API enforces the plan limit (channels) — a 402 here is the
// real answer, not a UI bug.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface WhatsAppNumber {
  id: string;
  phone_number_id: string;
  waba_id: string | null;
  status: string | null;
  is_default: boolean;
  registered_at: string | null;
  connected_at: string | null;
  last_error: string | null;
  last_registration_error: string | null;
  created_at: string | null;
}

const META_ID_RE = /^\d+$/;

export function WhatsAppNumbersCard({
  numbers,
  canEdit,
  onChanged,
}: {
  numbers: WhatsAppNumber[];
  canEdit: boolean;
  /** Re-read the account's numbers after a write. */
  onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations('Settings.whatsapp.numbers');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pin, setPin] = useState('');

  function resetForm() {
    setPhoneNumberId('');
    setWabaId('');
    setAccessToken('');
    setPin('');
  }

  async function handleAdd() {
    if (!META_ID_RE.test(phoneNumberId.trim())) {
      toast.error(t('phoneIdInvalid'));
      return;
    }
    if (wabaId.trim() && !META_ID_RE.test(wabaId.trim())) {
      toast.error(t('wabaIdInvalid'));
      return;
    }
    if (!accessToken.trim()) {
      toast.error(t('tokenRequired'));
      return;
    }
    if (pin.trim() && !/^\d{6}$/.test(pin.trim())) {
      toast.error(t('pinInvalid'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number_id: phoneNumberId.trim(),
          waba_id: wabaId.trim() || null,
          access_token: accessToken.trim(),
          pin: pin.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || t('addFailed'));
        return;
      }
      if (data.saved && !data.registered) {
        toast.warning(data.error || t('addedNotRegistered'));
      } else {
        toast.success(t('added'));
      }
      resetForm();
      setAdding(false);
      await onChanged();
    } catch (err) {
      console.error('add number failed:', err);
      toast.error(t('addFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handlePromote(id: string) {
    setBusyId(id);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('promoteFailed'));
        return;
      }
      toast.success(t('promoted'));
      await onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('deleteConfirm'))) return;
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/whatsapp/config?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleted'));
      await onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">{t('title')}</CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="space-y-2">
            {numbers.map((number) => {
              const hasError = Boolean(
                number.last_error || number.last_registration_error,
              );
              return (
                <li
                  key={number.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                >
                  <span
                    aria-hidden
                    className={
                      hasError
                        ? 'size-2 shrink-0 rounded-full bg-destructive'
                        : 'size-2 shrink-0 rounded-full bg-emerald-500'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      dir="ltr"
                      className="truncate text-start font-mono text-sm leading-5 text-foreground"
                    >
                      {number.phone_number_id}
                    </p>
                    <p className="truncate text-xs leading-4 text-muted-foreground">
                      {hasError
                        ? t('errorBadge')
                        : number.is_default
                          ? t('defaultBadge')
                          : t('activeBadge')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canEdit && !number.is_default && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5"
                        disabled={busyId === number.id}
                        onClick={() => handlePromote(number.id)}
                      >
                        <Star className="size-3.5" />
                        {t('setDefault')}
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={t('delete')}
                        disabled={busyId === number.id}
                        onClick={() => handleDelete(number.id)}
                      >
                        {busyId === number.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && !adding && (
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2 border-dashed text-muted-foreground hover:text-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" />
            {t('add')}
          </Button>
        )}

        {adding && (
          <div className="space-y-3 rounded-lg border border-border/60 p-4">
            <p className="text-sm font-medium text-foreground">{t('addTitle')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-phone-number-id">{t('phoneNumberId')}</Label>
                <Input
                  id="new-phone-number-id"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="1234567890"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-waba-id">{t('wabaId')}</Label>
                <Input
                  id="new-waba-id"
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="0987654321"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="new-access-token">{t('accessToken')}</Label>
                <Input
                  id="new-access-token"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  dir="ltr"
                  type="password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-pin">{t('pin')}</Label>
                <Input
                  id="new-pin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="123456"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={handleAdd} disabled={saving}>
                {saving && <Loader2 className="size-4 me-1.5 animate-spin" />}
                {t('save')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  resetForm();
                  setAdding(false);
                }}
                disabled={saving}
              >
                {t('cancel')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
