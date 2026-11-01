'use client';

// ============================================================
// /reports — the reports module.
//
// Three ways in, one code path out:
//   * a preset card  → fills the builder and runs it;
//   * a saved report → fills the builder with its stored config and runs it;
//   * the builder    → any dataset/metric/dimension/filter combination.
//
// All three end at POST /api/reports/run, so what a manager saves is exactly
// what they were looking at — the saved row is the normalised config the
// server echoed back, not the draft in the form.
//
// Reference data for the filters (members, tags, pipelines/stages, numbers,
// broadcasts) is read through the RLS-scoped browser client: they are
// already account-visible rows and none of them is sensitive beyond that.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Bell, CalendarClock, Loader2, Lock, Pencil, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useEntitlements } from '@/hooks/use-entitlements';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  PRESETS,
  addDays,
  agentPlaceholderKey,
  browserTimeZone,
  presetConfig,
  todayIn,
  type ReportConfig,
  type ReportPreset,
} from '@/lib/reports/catalog';
import { canSave as canSaveReports, reportAccess } from '@/lib/reports/access';
import type { ReportResult } from '@/lib/reports/run';
import {
  ReportControls,
  type ReportOptions,
} from '@/components/reports/report-controls';
import { ReportResults } from '@/components/reports/report-results';
import { ScheduleDialog, type ScheduleRecord } from '@/components/reports/schedule-dialog';
import { AlertDialog } from '@/components/reports/alert-dialog';

interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  config: ReportConfig;
  created_by: string | null;
  is_shared: boolean;
  updated_at: string;
}

const EMPTY_OPTIONS: ReportOptions = {
  agents: [],
  tags: [],
  pipelines: [],
  stages: [],
  numbers: [],
  broadcasts: [],
};

export default function ReportsPage() {
  const t = useTranslations('Reports');
  const locale = useLocale();
  const { defaultCurrency, user } = useAuth();
  const { entitlements } = useEntitlements();

  const timeZone = useMemo(() => browserTimeZone(), []);
  const today = useMemo(() => todayIn(timeZone), [timeZone]);

  const [config, setConfig] = useState<ReportConfig>(() =>
    presetConfig(PRESETS[0], { today, timeZone }),
  );
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [schedules, setSchedules] = useState<Record<string, ScheduleRecord>>({});
  const [scheduleFor, setScheduleFor] = useState<SavedReport | null>(null);
  const [alertFor, setAlertFor] = useState<SavedReport | null>(null);
  const [savedLoading, setSavedLoading] = useState(true);
  const [activePreset, setActivePreset] = useState<string | null>(PRESETS[0].id);
  const [activeSaved, setActiveSaved] = useState<string | null>(null);

  const [options, setOptions] = useState<ReportOptions>(EMPTY_OPTIONS);
  const [saving, setSaving] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [editing, setEditing] = useState<SavedReport | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'html' | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [analysis, setAnalysis] = useState<{ text: string; model: string; rows: number } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // One source of truth for what the plan allows: the same object decides what
  // this page renders and what the server accepts.
  const access = useMemo(() => reportAccess(entitlements), [entitlements]);
  const advanced = access.custom;
  const canSaveReport = canSaveReports(access);
  const historyDays = access.historyDays;

  const planMessage = useCallback(
    (code: string | undefined, limit?: number | null) => {
      switch (code) {
        case 'reports_custom_missing':
        case 'reports_saved_not_in_plan':
          return t('locked.custom');
        case 'reports_saved_limit':
          return t('locked.savedLimit', { count: limit ?? access.savedLimit ?? 0 });
        case 'reports_history_limit':
          return t('locked.historyLimit', { count: limit ?? historyDays ?? 0 });
        case 'metric_not_in_plan':
          return t('advancedOnly');
        default:
          return t('error');
      }
    },
    [access.savedLimit, historyDays, t],
  );

  const post = useCallback(
    async (payload: unknown) => {
      setRunning(true);
      setError(null);
      try {
        const response = await fetch('/api/reports/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setError(planMessage(body?.error, body?.limit));
          setResult(null);
          return;
        }
        const body = (await response.json()) as { config: ReportConfig; result: ReportResult };
        // The server may have normalised the period (empty → last 30 days);
        // adopt what it actually ran so the controls match the table.
        setConfig(body.config);
        setResult(body.result);
      } catch {
        setError(t('error'));
        setResult(null);
      } finally {
        setRunning(false);
      }
    },
    [planMessage, t],
  );

  /** The builder path — Growth and Scale only. */
  const run = useCallback((next: ReportConfig) => post({ config: next }), [post]);

  /**
   * The ready-made path — every plan. The server builds the config from the
   * catalogue, so this cannot be used to smuggle a custom report through.
   */
  const runPreset = useCallback(
    (presetId: string, days: number, compare?: boolean) =>
      post({ preset: presetId, days, compare: compare === true }),
    [post],
  );

  const loadSaved = useCallback(async () => {
    try {
      const response = await fetch('/api/reports', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        reports: SavedReport[];
        schedules?: ScheduleRecord[];
      };
      setSaved(payload.reports ?? []);
      const map: Record<string, ScheduleRecord> = {};
      for (const schedule of payload.schedules ?? []) map[schedule.saved_report_id] = schedule;
      setSchedules(map);
    } finally {
      setSavedLoading(false);
    }
  }, []);

  const loadOptions = useCallback(async () => {
    const supabase = createClient();
    const [members, tags, pipelines, numbers, broadcasts] = await Promise.all([
      fetch('/api/account/members', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { members: [] }))
        .catch(() => ({ members: [] })),
      supabase.from('tags').select('id, name').order('name').limit(200),
      supabase.from('pipelines').select('id, name, pipeline_stages(id, name, position)').limit(50),
      supabase.from('whatsapp_config').select('id, display_phone_number, verified_name').limit(20),
      supabase.from('broadcasts').select('id, name').order('created_at', { ascending: false }).limit(100),
    ]);

    const membersList =
      (members as { members?: { user_id: string; full_name: string | null }[] }).members ?? [];
    const pipelineRows = (pipelines.data ?? []) as {
      id: string;
      name: string;
      pipeline_stages?: { id: string; name: string; position: number }[] | null;
    }[];

    setOptions({
      agents: membersList
        .map((member) => ({
          value: member.user_id,
          label: member.full_name || '—',
        }))
        .filter((option) => Boolean(option.value)),
      tags: ((tags.data ?? []) as { id: string; name: string }[]).map((tag) => ({
        value: tag.id,
        label: tag.name,
      })),
      pipelines: pipelineRows.map((pipeline) => ({ value: pipeline.id, label: pipeline.name })),
      stages: pipelineRows.flatMap((pipeline) =>
        (pipeline.pipeline_stages ?? [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((stage) => ({ value: stage.id, label: stage.name })),
      ),
      numbers: ((numbers.data ?? []) as {
        id: string;
        display_phone_number: string | null;
        verified_name: string | null;
      }[]).map((row) => ({
        value: row.id,
        label: row.display_phone_number || row.verified_name || '—',
      })),
      broadcasts: ((broadcasts.data ?? []) as { id: string; name: string }[]).map((row) => ({
        value: row.id,
        label: row.name,
      })),
    });
  }, []);

  useEffect(() => {
    void loadSaved();
    void loadOptions();
    // The button only exists when the account configured its own AI provider;
    // the server is the one that decides, so ask it once.
    fetch('/api/reports/analyze', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { available: false }))
      .then((payload) => setAiAvailable(payload?.available === true))
      .catch(() => setAiAvailable(false));
  }, [loadSaved, loadOptions]);

  const analyze = useCallback(async () => {
    if (!result) return;
    setAnalysing(true);
    setAnalysisError(null);
    try {
      const response = await fetch('/api/reports/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          locale,
          currency: defaultCurrency,
          title: saved.find((item) => item.id === activeSaved)?.name ?? t(`presets.${activePreset ?? 'volume'}`),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setAnalysisError(
          payload?.error === 'ai_not_configured'
            ? t('ai.notConfigured')
            : payload?.error === 'empty_report'
              ? t('empty')
              : t('ai.failed'),
        );
        return;
      }
      setAnalysis({
        text: payload.analysis as string,
        model: payload.model as string,
        rows: (payload.basedOn?.rows as number) ?? 0,
      });
    } catch {
      setAnalysisError(t('ai.failed'));
    } finally {
      setAnalysing(false);
    }
  }, [activePreset, activeSaved, config, defaultCurrency, locale, result, saved, t]);

  // First paint runs the default preset so the page is never an empty form.
  useEffect(() => {
    const days = Math.min(PRESETS[0].days, historyDays ?? PRESETS[0].days);
    void runPreset(PRESETS[0].id, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreset = (preset: ReportPreset) => {
    const days = Math.min(preset.days, historyDays ?? preset.days);
    setActivePreset(preset.id);
    setActiveSaved(null);
    setConfig(presetConfig(preset, { today, timeZone, days }));
    void runPreset(preset.id, days, config.compare);
  };

  const applySaved = (report: SavedReport) => {
    setActivePreset(null);
    setActiveSaved(report.id);
    const next: ReportConfig = {
      ...report.config,
      // A saved report remembers its shape, not its dates: the question
      // "last 30 days" must not silently become "the 30 days of last March".
      from: addDays(today, -29),
      to: today,
      tz: timeZone,
    };
    setConfig(next);
    void run(next);
  };

  // One dialog, two verbs: saving a new report and editing an existing one
  // differ only by the method and the URL, so the form cannot drift.
  const save = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(editing ? `/api/reports/${editing.id}` : '/api/reports', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDescription.trim() || null,
          // Renaming must not quietly replace the definition with whatever
          // happens to be in the builder right now.
          ...(editing ? {} : { config }),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error === 'metric_not_in_plan' ? t('advancedOnly') : t('saveFailed'));
        return;
      }
      setSaveOpen(false);
      setEditing(null);
      setSaveName('');
      setSaveDescription('');
      await loadSaved();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (report: SavedReport) => {
    const response = await fetch(`/api/reports/${report.id}`, { method: 'DELETE' });
    if (response.ok) {
      if (activeSaved === report.id) setActiveSaved(null);
      await loadSaved();
    }
  };

  const exportAs = async (format: 'csv' | 'html') => {
    if (!result) return;
    setExporting(format);
    try {
      const headers: Record<string, string> = {};
      for (const column of result.columns) {
        headers[column.key] =
          column.kind === 'number'
            ? t(`metrics.${column.key}`)
            : column.key === 'period'
              ? t('dimensions.period')
              : t(`dimensions.${column.key}`);
      }

      const response = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          format,
          locale,
          currency: defaultCurrency,
          labels: {
            title: saved.find((item) => item.id === activeSaved)?.name ?? t(`presets.${activePreset ?? 'volume'}`),
            subtitle: t(`datasets.${result.dataset}`),
            columns: headers,
            totals: t('totals'),
            period: t('periodLabel', { from: result.from, to: result.to }),
            generated: t('generatedAt', {
              when: new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: result.timeZone,
              }).format(new Date()),
            }),
            rowCount: t('rowsCount', { count: result.rowCount }),
            truncated: t('truncated', { count: result.limit }),
            agentPlaceholder: t(`agentPlaceholder.${agentPlaceholderKey(result.dataset)}`),
            footer: t('footerNote'),
          },
        }),
      });
      if (!response.ok) {
        setError(t('exportFailed'));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (format === 'csv') {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${result.dataset}-${result.from}-${result.to}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch {
      setError(t('exportFailed'));
    } finally {
      setExporting(null);
    }
  };

  const canRun = config.metrics.length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t('presetsLabel')}</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((preset) => {
            const locked = preset.advanced === true && !advanced;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={locked}
                title={locked ? t('advancedOnly') : undefined}
                onClick={() => applyPreset(preset)}
                className={cn(
                  'rounded-lg border p-3 text-start text-sm transition',
                  activePreset === preset.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40',
                  locked && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="font-medium">{t(`presets.${preset.id}`)}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {t(`datasets.${preset.dataset}`)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('builderTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {advanced ? (
            <ReportControls
              config={config}
              onChange={(next) => {
                setConfig(next);
                setActivePreset(null);
              }}
              onRun={() => void run(config)}
              running={running}
              advanced={advanced}
              options={options}
              canRun={canRun}
              historyDays={historyDays}
            />
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lock className="size-4 text-muted-foreground" />
                {t('locked.builderTitle')}
              </div>
              <p className="text-xs text-muted-foreground">{t('locked.builderBody')}</p>
              <a
                href="/settings?tab=plan"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline decoration-dotted underline-offset-2"
              >
                {t('locked.upgrade')}
                <ArrowUpRight className="size-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {running && !result ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="me-2 size-4 animate-spin" /> {t('running')}
            </div>
          ) : (
            <ReportResults
              result={result}
              currency={defaultCurrency}
              aiAvailable={aiAvailable}
              analysing={analysing}
              analysis={analysis}
              analysisError={analysisError}
              onAnalyze={() => void analyze()}
              onDismissAnalysis={() => {
                setAnalysis(null);
                setAnalysisError(null);
              }}
              canSave={canSaveReport}
              saving={saving}
              exporting={exporting}
              onSave={() => {
                setEditing(null);
                setSaveName(
                  activeSaved
                    ? (saved.find((item) => item.id === activeSaved)?.name ?? '')
                    : t(`presets.${activePreset ?? 'volume'}`),
                );
                setSaveOpen(true);
              }}
              onExport={(format) => void exportAs(format)}
            />
          )}
        </CardContent>
      </Card>

      <section className={cn('space-y-3', !canSaveReport && 'hidden')}>
        <h2 className="text-sm font-medium text-muted-foreground">{t('savedLabel')}</h2>
        {savedLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t('loading')}
          </div>
        ) : saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noSaved')}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {saved.map((report) => (
              <div
                key={report.id}
                className={cn(
                  'flex items-start justify-between gap-3 rounded-lg border p-3',
                  activeSaved === report.id ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <button
                  type="button"
                  onClick={() => applySaved(report)}
                  className="flex-1 text-start"
                >
                  <span className="text-sm font-medium">{report.name}</span>
                  {report.description && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {report.description}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {t(`datasets.${report.dataset}`)}
                    {!report.is_shared && ` · ${t('private')}`}
                    {report.created_by === user?.id && ` · ${t('mine')}`}
                    {schedules[report.id] && (
                      <>
                        {` · ${t('schedule.badge', {
                          cadence: t(`schedule.cadence.${schedules[report.id].cadence}`),
                          hour: `${String(schedules[report.id].hour).padStart(2, '0')}:00`,
                        })}`}
                      </>
                    )}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('alerts.button')}
                    onClick={() => setAlertFor(report)}
                  >
                    <Bell className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('schedule.button')}
                    onClick={() => setScheduleFor(report)}
                  >
                    <CalendarClock className={cn('size-4', schedules[report.id] && 'text-primary')} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('rename')}
                    onClick={() => {
                      setEditing(report);
                      setSaveName(report.name);
                      setSaveDescription(report.description ?? '');
                      setSaveOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('delete')}
                    onClick={() => void remove(report)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {alertFor && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setAlertFor(null);
          }}
          reportId={alertFor.id}
          reportName={alertFor.name}
          metrics={alertFor.config.metrics ?? []}
          dataset={alertFor.config.dataset}
          onSaved={() => void loadSaved()}
        />
      )}

      {scheduleFor && (
        <ScheduleDialog
          open
          onOpenChange={(open) => {
            if (!open) setScheduleFor(null);
          }}
          reportId={scheduleFor.id}
          reportName={scheduleFor.name}
          timeZone={timeZone}
          initial={schedules[scheduleFor.id] ?? null}
          onSaved={() => {
            setScheduleFor(null);
            void loadSaved();
          }}
        />
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('renameTitle') : t('saveTitle')}</DialogTitle>
            <DialogDescription>{t('saveDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={saveName}
              maxLength={80}
              onChange={(event) => setSaveName(event.target.value)}
              placeholder={t('namePlaceholder')}
            />
            <Textarea
              value={saveDescription}
              maxLength={280}
              onChange={(event) => setSaveDescription(event.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={saving || !saveName.trim()} onClick={() => void save()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
