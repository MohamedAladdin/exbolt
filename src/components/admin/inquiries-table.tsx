'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Check, Mail, Phone, Search } from 'lucide-react';

import { adminT } from '@/lib/admin/copy';
import type { InquiryRow } from '@/lib/admin/queries';
import { DataTable, EmptyRow, TD, TH, THead } from '@/components/admin/ui';

const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'archived'] as const;

const STATUS_CLASS: Record<string, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  contacted: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  qualified: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  won: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  lost: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  archived: 'border-border bg-muted text-muted-foreground',
};

export function InquiriesTable({ rows: initial }: { rows: InquiryRow[] }) {
  const locale = useLocale();
  const t = adminT(locale);
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    return {
      total: rows.length,
      fresh: rows.filter((row) => row.status === 'new').length,
      open: rows.filter((row) => ['contacted', 'qualified'].includes(row.status)).length,
      won: rows.filter((row) => row.status === 'won').length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false;
      if (!needle) return true;
      return [row.name, row.email, row.company, row.phone, row.message]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [rows, filter, query]);

  const fmt = (value: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

  const patch = async (id: string, body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(`/api/admin/inquiries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        inquiry?: InquiryRow;
        error?: string;
      };
      if (!response.ok || !result.inquiry) throw new Error(result.error || 'update_failed');
      setRows((current) =>
        current.map((row) => (row.id === id ? { ...row, ...result.inquiry } : row))
      );
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
          { label: t('inquiries.total'), value: counts.total, tone: 'text-foreground' },
          { label: t('inquiries.newCount'), value: counts.fresh, tone: 'text-blue-500' },
          { label: t('inquiries.open'), value: counts.open, tone: 'text-amber-600 dark:text-amber-400' },
          { label: t('inquiries.wonCount'), value: counts.won, tone: 'text-emerald-500' },
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
              placeholder={t('inquiries.search')}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-foreground/30 h-8 w-full rounded-md border ps-8 pe-2 text-sm focus:outline-none"
            />
          </div>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="border-border bg-background text-foreground h-8 rounded-md border px-2 text-xs"
            aria-label={t('status')}
          >
            <option value="all">{t('all')}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`inquiry.status.${status}`)}
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
              <TH>{t('inquiries.contact')}</TH>
              <TH>{t('inquiries.plan')}</TH>
              <TH>{t('status')}</TH>
              <TH>{t('date')}</TH>
              <TH className="text-end">{t('actions')}</TH>
            </THead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={5}>{t('inquiries.empty')}</EmptyRow>
              ) : (
                filtered.map((row) => {
                  const isOpen = openId === row.id;
                  return (
                    <tr key={row.id} className="border-border border-b align-top last:border-0">
                      <TD className="py-3">
                        <div className="font-medium">
                          {row.name}
                          {row.company ? (
                            <span className="text-muted-foreground font-normal"> · {row.company}</span>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <a className="hover:text-foreground inline-flex items-center gap-1" href={`mailto:${row.email}`}>
                            <Mail className="size-3" />
                            <span dir="ltr">{row.email}</span>
                          </a>
                          {row.phone ? (
                            <a className="hover:text-foreground inline-flex items-center gap-1" href={`tel:${row.phone}`}>
                              <Phone className="size-3" />
                              <span dir="ltr">{row.phone}</span>
                            </a>
                          ) : null}
                        </div>
                      </TD>
                      <TD className="py-3">
                        <div className="text-xs">{row.plan ?? '—'}</div>
                        <div className="text-muted-foreground mt-1 text-[11px]">
                          {row.team_size ?? '—'}
                        </div>
                      </TD>
                      <TD className="py-3">
                        <select
                          value={row.status}
                          disabled={busy === `status:${row.id}`}
                          onChange={(event) =>
                            patch(row.id, { status: event.target.value }, `status:${row.id}`)
                          }
                          className={`h-7 rounded-full border px-2 text-[11px] font-medium ${STATUS_CLASS[row.status] ?? STATUS_CLASS.archived}`}
                          aria-label={t('status')}
                        >
                          {STATUSES.map((status) => (
                            <option key={status} value={status} className="bg-card text-foreground">
                              {t(`inquiry.status.${status}`)}
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
                          {isOpen ? t('inquiries.hide') : t('inquiries.details')}
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
                        {t('inquiries.message')}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{row.message || '—'}</p>
                    </div>
                    <div className="text-muted-foreground mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
                      <span>
                        {t('inquiries.source')}: {row.locale.toUpperCase()} · {row.source}
                      </span>
                      {row.page ? (
                        <span dir="ltr" className="font-mono">
                          {row.page}
                        </span>
                      ) : null}
                    </div>
                    <label className="text-muted-foreground mb-1 block text-[11px] font-medium uppercase tracking-wide">
                      {t('inquiries.notes')}
                    </label>
                    <textarea
                      value={notes[row.id] ?? row.notes ?? ''}
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
                            { notes: notes[row.id] ?? row.notes ?? '' },
                            `notes:${row.id}`
                          )
                        }
                        className="bg-foreground text-background rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        {t('inquiries.saveNotes')}
                      </button>
                      {saved === row.id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                          <Check className="size-3" />
                          {t('inquiries.saved')}
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
