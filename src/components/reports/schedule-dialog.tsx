'use client';

// ============================================================
// Schedule dialog for a saved report.
//
// Two cadences, one hour, a recipient list — nothing else. The weekday and
// day-of-month fields swap with the cadence, because a weekly schedule with a
// day-of-month is the kind of "valid" input that silently never fires.
// ============================================================

import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface ScheduleRecord {
  saved_report_id: string;
  cadence: 'weekly' | 'monthly';
  weekday: number | null;
  day_of_month: number | null;
  hour: number;
  time_zone: string;
  recipients: string[];
  format: 'csv' | 'html';
  is_active: boolean;
  last_sent_at: string | null;
  last_error: string | null;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function ScheduleDialog({
  open,
  onOpenChange,
  reportId,
  reportName,
  timeZone,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  reportName: string;
  timeZone: string;
  initial: ScheduleRecord | null;
  onSaved: () => void;
}) {
  const t = useTranslations('Reports.schedule');
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>('weekly');
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(8);
  const [recipients, setRecipients] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initial) {
      setCadence(initial.cadence);
      setWeekday(initial.weekday ?? 1);
      setDayOfMonth(initial.day_of_month ?? 1);
      setHour(initial.hour);
      setRecipients(initial.recipients.join(', '));
      setIsActive(initial.is_active);
    } else {
      setCadence('weekly');
      setWeekday(1);
      setDayOfMonth(1);
      setHour(8);
      setRecipients('');
      setIsActive(true);
    }
  }, [open, initial]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cadence,
          weekday: cadence === 'weekly' ? weekday : null,
          dayOfMonth: cadence === 'monthly' ? dayOfMonth : null,
          hour,
          timeZone,
          recipients,
          isActive,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error === 'no_recipients' ? t('needsRecipient') : t('saveFailed'));
        return;
      }
      onOpenChange(false);
      onSaved();
    } catch {
      setError(t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await fetch(`/api/reports/${reportId}/schedule`, { method: 'DELETE' });
      onOpenChange(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{reportName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            {(['weekly', 'monthly'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCadence(option)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs',
                  cadence === option
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                {t(`cadence.${option}`)}
              </button>
            ))}
          </div>

          {cadence === 'weekly' ? (
            <label className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('weekday')}</span>
              <select
                value={weekday}
                onChange={(event) => setWeekday(Number(event.target.value))}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                {WEEKDAYS.map((day) => (
                  <option key={day} value={day}>
                    {t(`days.${day}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t('dayOfMonth')}</span>
              <select
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(Number(event.target.value))}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('hour')}</span>
            <select
              value={hour}
              onChange={(event) => setHour(Number(event.target.value))}
              className="h-9 rounded-md border border-border bg-background px-2"
              dir="ltr"
            >
              {Array.from({ length: 24 }, (_, index) => index).map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1">
            <span className="text-muted-foreground">{t('recipients')}</span>
            <Textarea
              value={recipients}
              onChange={(event) => setRecipients(event.target.value)}
              placeholder="manager@clinic.com, owner@clinic.com"
              rows={2}
              dir="ltr"
            />
            <p className="text-[11px] text-muted-foreground">{t('recipientsHint')}</p>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="size-3.5"
            />
            {t('active')}
          </label>

          {initial?.last_error && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
              {t('lastError')}: {initial.last_error}
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          {initial && (
            <Button type="button" variant="ghost" onClick={() => void remove()} disabled={busy}>
              <Trash2 className="size-4" />
              {t('stop')}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
