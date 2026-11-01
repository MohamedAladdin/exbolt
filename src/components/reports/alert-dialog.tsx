'use client';

// ============================================================
// Alert rules for one saved report.
//
// One rule per metric: the metric list is the report's own, the operator is a
// direction, and the threshold is a number. Anything more (a query builder, a
// per-rule recipient list) turns a useful ping into a configuration project.
// ============================================================

import { useEffect, useState } from 'react';
import { Bell, Loader2, Trash2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { metricUnit } from '@/lib/reports/catalog';
import { formatMetric } from '@/lib/reports/run';
import { useLocale } from 'next-intl';

export interface AlertRecord {
  id: string;
  saved_report_id: string;
  metric: string;
  comparator: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  cooldown_hours: number;
  is_active: boolean;
  last_fired_at: string | null;
  last_checked_at: string | null;
  last_value: number | null;
}

const COMPARATORS = ['gt', 'gte', 'lt', 'lte'] as const;
const COOLDOWNS = [1, 6, 24, 48, 168] as const;

export function AlertDialog({
  open,
  onOpenChange,
  reportId,
  reportName,
  metrics,
  dataset,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  reportName: string;
  metrics: string[];
  dataset: Parameters<typeof metricUnit>[0];
  onSaved: () => void;
}) {
  const t = useTranslations('Reports.alerts');
  const tm = useTranslations('Reports.metrics');
  const locale = useLocale();
  const [rules, setRules] = useState<AlertRecord[]>([]);
  const [metric, setMetric] = useState(metrics[0] ?? '');
  const [comparator, setComparator] = useState<(typeof COMPARATORS)[number]>('gt');
  const [threshold, setThreshold] = useState('0');
  const [cooldown, setCooldown] = useState<number>(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch(`/api/reports/${reportId}/alerts`, { cache: 'no-store' });
    if (!response.ok) return;
    const payload = (await response.json()) as { alerts: AlertRecord[] };
    setRules(payload.alerts ?? []);
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setMetric(metrics[0] ?? '');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/alerts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric, comparator, threshold: Number(threshold), cooldownHours: cooldown }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error === 'metric_not_in_report' ? t('metricNotInReport') : t('saveFailed'));
        return;
      }
      await load();
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ruleMetric: string) => {
    setBusy(true);
    try {
      await fetch(`/api/reports/${reportId}/alerts?metric=${encodeURIComponent(ruleMetric)}`, {
        method: 'DELETE',
      });
      await load();
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const value = (raw: number | null, key: string) =>
    formatMetric(raw, metricUnit(dataset, key), { locale });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{reportName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {rules.length > 0 && (
            <ul className="space-y-1.5">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                >
                  <span>
                    <Bell className="me-1 inline size-3 text-primary" />
                    {tm(rule.metric)}{' '}
                    {t(`comparator.${rule.comparator}`)} {value(rule.threshold, rule.metric)}
                    {rule.last_value != null && (
                      <span className="text-muted-foreground">
                        {' · '}
                        {t('lastValue', { value: value(rule.last_value, rule.metric) })}
                      </span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('remove')}
                    onClick={() => void remove(rule.metric)}
                    disabled={busy}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-muted-foreground">{t('metric')}</span>
              <select
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                {metrics.map((key) => (
                  <option key={key} value={key}>
                    {tm(key)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t('comparator.label')}</span>
              <select
                value={comparator}
                onChange={(event) => setComparator(event.target.value as (typeof COMPARATORS)[number])}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                {COMPARATORS.map((key) => (
                  <option key={key} value={key}>
                    {t(`comparator.${key}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">{t('threshold')}</span>
              <Input
                type="number"
                inputMode="decimal"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                className="h-9"
                dir="ltr"
              />
            </label>

            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-muted-foreground">{t('cooldown')}</span>
              <select
                value={cooldown}
                onChange={(event) => setCooldown(Number(event.target.value))}
                className="h-9 rounded-md border border-border bg-background px-2"
              >
                {COOLDOWNS.map((hours) => (
                  <option key={hours} value={hours}>
                    {t('cooldownHours', { count: hours })}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy || !metric}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
