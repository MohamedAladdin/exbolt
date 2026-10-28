'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Check, Search } from 'lucide-react';

import { adminT } from '@/lib/admin/copy';
import type { AccountRequestRow } from '@/lib/admin/queries';
import { DataTable, EmptyRow, TD, TH, THead } from '@/components/admin/ui';

const STATUSES = ['new', 'in_review', 'done', 'declined'] as const;
const KINDS = ['renewal', 'change_plan'] as const;

const STATUS_CLASS: Record<string, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  in_review: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  declined: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
};

export function RequestsTable({ rows: initial }: { rows: AccountRequestRow[] }) {
  const locale = useLocale();
  const t = adminT(locale);
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      total: rows.length,
      fresh: rows.filter((row) => row.status === 'new').length,
      review: rows.filter((row) => row.status === 'in_review').length,
      done: rows.filter((row) => row.status === 'done').length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (kind !== 'all' && row.kind !== kind) return false;
      if (!needle) return true;
      return [row.accountName, row.requesterEmail, row.requesterName, row.account_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, query, status, kind]);

  const fmt = (value: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

  const patch = async (id: string, body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(`/api/admin/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        request?: AccountRequestRow;
        error?: string;
      };
      if (!response.ok || !result.request) throw new Error(result.error || 'update_failed');
      setRows((current) =>
        current.map((row) =>
          row.id === id
            ? {
                ...row,
                status: result.request!.status,
                admin_notes: result.request!.admin_notes,
                updated_at: result.request!.updated_at,
              }
            : row
        )
      );
      if (key.startsWith('status')) router.refresh();
      if (key.startsWith('notes')) {
        setSaved(id);
        window.setTimeout(() => setSaved(null), 1800);
      }
    } catch {
      setError(t('err.unknown'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t('requests.title'), value: counts.total, tone: 'text-foreground' },
          { label: t('request.status.new'), value: counts.fresh, tone: 'text-blue-500' },
          {
            label: t('request.status.in_review'),
            value: counts.review,
            tone: 'text-amber-600 dark:text-amber-400',
          },
          { label: t('request.status.done'), value: counts.done, tone: 'text-emerald-500' },
        ].map((stat) => (
          <div key={stat.label} className="border-border bg-card rounded-xl border px-4 py-3">
            <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {stat.label}
            </div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${stat.tone}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="border-border bg-card rounded-xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="relative min-w-52 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute inset-y-0 start-2.5 my-auto size-3.5" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('requests.search')}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-foreground/30 h-8 w-full rounded-md border ps-8 pe-2 text-sm focus:outline-none"
            />
          </div>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="border-border bg-background text-foreground h-8 rounded-md border px-2 text-xs"
            aria-label={t('requests.type')}
          >
            <option value="all">{t('all')}</option>
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`request.kind.${value}`)}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="border-border bg-background text-foreground h-8 rounded-md border px-2 text-xs"
            aria-label={t('status')}
          >
            <option value="all">{t('all')}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`request.status.${value}`)}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground text-xs tabular-nums">
            {filtered.length} / {rows.length}
          </span>
        </div>

        {error ? (
          <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : null}

        <div className="p-4">
          <DataTable>
            <THead>
              <TH>{t('requests.account')}</TH>
              <TH>{t('requests.type')}</TH>
              <TH>{t('requests.plan')}</TH>
              <TH>{t('status')}</TH>
              <TH>{t('date')}</TH>
              <TH className="text-end">{t('actions')}</TH>
            </THead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={6}>{t('requests.empty')}</EmptyRow>
              ) : (
                filtered.map((row) => {
                  const isOpen = openId === row.id;
                  return (
                    <tr key={row.id} className="border-border border-b align-top last:border-0">
                      <TD className="py-3">
                        <div className="font-medium">{row.accountName ?? row.account_id}</div>
                        <div className="text-muted-foreground mt-1 text-[11px]">
                          {row.requesterName ? `${row.requesterName} · ` : ''}
                          <span dir="ltr">{row.requesterEmail ?? '—'}</span>
                        </div>
                      </TD>
                      <TD className="py-3">
                        <span className="border-border bg-muted rounded-full border px-2 py-0.5 text-[11px]">
                          {t(`request.kind.${row.kind}`)}
                        </span>
                      </TD>
                      <TD className="py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          {row.kind === 'change_plan' ? (
                            <>
                              <span className="font-mono">{row.current_plan_code ?? '—'}</span>
                              <span className="text-muted-foreground">→</span>
                            </>
                          ) : null}
                          <span className="font-mono font-semibold">
                            {row.requested_plan_code ?? '—'}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1 text-[11px]">
                          {t(row.billing_interval === 'monthly' ? 'plan.monthly' : 'plan.annual')}
                        </div>
                      </TD>
                      <TD className="py-3">
                        <select
                          value={row.status}
                          disabled={busy === `status:${row.id}`}
                          onChange={(event) =>
                            patch(row.id, { status: event.target.value }, `status:${row.id}`)
                          }
                          className={`h-7 rounded-full border px-2 text-[11px] font-medium ${STATUS_CLASS[row.status] ?? STATUS_CLASS.new}`}
                          aria-label={t('status')}
                        >
                          {STATUSES.map((value) => (
                            <option key={value} value={value} className="bg-card text-foreground">
                              {t(`request.status.${value}`)}
                            </option>
                          ))}
                        </select>
                      </TD>
                      <TD className="text-muted-foreground py-3 text-xs">
                        {fmt(row.created_at)}
                      </TD>
                      <TD className="py-3 text-end">
                        <button
                          type="button"
                          onClick={() => setOpenId(isOpen ? null : row.id)}
                          className="border-border hover:bg-muted rounded-md border px-2 py-1 text-xs"
                        >
                          {isOpen ? t('requests.hide') : t('requests.details')}
                        </button>
                      </TD>
                    </tr>
                  );
                })
              )}
            </tbody>
          </DataTable>

          {openId
            ? filtered
                .filter((row) => row.id === openId)
                .map((row) => (
                  <div key={row.id} className="border-border mt-3 rounded-lg border bg-muted/30 p-4">
                    <div className="mb-3">
                      <div className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wide">
                        {t('requests.message')}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{row.message || '—'}</p>
                    </div>
                    <label className="text-muted-foreground mb-1 block text-[11px] font-medium uppercase tracking-wide">
                      {t('requests.notes')}
                    </label>
                    <textarea
                      value={notes[row.id] ?? row.admin_notes ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                      rows={3}
                      className="border-border bg-background text-foreground focus:border-foreground/30 w-full rounded-md border p-2 text-sm focus:outline-none"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy === `notes:${row.id}`}
                        onClick={() =>
                          patch(
                            row.id,
                            { notes: notes[row.id] ?? row.admin_notes ?? '' },
                            `notes:${row.id}`
                          )
                        }
                        className="bg-foreground text-background rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        {t('requests.saveNotes')}
                      </button>
                      {saved === row.id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                          <Check className="size-3" />
                          {t('requests.saved')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
            : null}
        </div>
      </div>
    </div>
  );
}
