'use client';

// ============================================================
// ActivityLog — Settings → Activity log
//
// Read-only timeline of everything that changed inside this account:
// settings, integrations, content, automations, team roles and inbox
// assignments — with the person who did it.
//
// The data is written by database triggers (migration 070), not by
// this screen, so the panel is deliberately dumb: it renders rows and
// never claims an event that did not happen. Every copy line here has
// to stay honest about that, because the whole point is that two
// admins can settle "who changed this?" without a meeting.
//
// Admin+ only (RLS + the route guard); the settings rail hides the
// entry for agents and viewers.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  FileText,
  History,
  Inbox,
  Loader2,
  Lock,
  PlugZap,
  RefreshCw,
  Search,
  Settings2,
  UserCog,
  UsersRound,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsChip } from '@/components/settings/settings-chip';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  ACTIVITY_CATEGORIES,
  actionKey,
  fieldKey,
  groupByDay,
  isDestructive,
  previewValue,
  valueKind,
  visibleChanges,
  type ActivityActor,
  type ActivityCategory,
  type ActivityEvent,
} from '@/lib/audit/activity';

const PAGE_SIZE = 50;
/** Changes shown inline before the row offers "and N more". */
const INLINE_CHANGES = 3;

const CATEGORY_ICON: Record<ActivityCategory, typeof History> = {
  members: UsersRound,
  settings: Settings2,
  integrations: PlugZap,
  content: FileText,
  automations: Zap,
  inbox: Inbox,
};

function initials(name: string | null, email: string | null): string {
  const source = (name ?? email ?? '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ActivityLog() {
  const t = useTranslations('Settings.activity');
  const tRoles = useTranslations('Settings.roles');
  const locale = useLocale();

  const [category, setCategory] = useState<'all' | ActivityCategory>('all');
  const [actorId, setActorId] = useState('all');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [actors, setActors] = useState<ActivityActor[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  // Debounce the search box: every keystroke would otherwise be a
  // request, and the log is the one screen an admin scrubs through.
  useEffect(() => {
    const id = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const fetchPage = useCallback(
    async (before?: number | null) => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      if (category !== 'all') params.set('category', category);
      if (actorId !== 'all') params.set('actor', actorId);
      if (term) params.set('q', term);
      if (before) params.set('before', String(before));

      const res = await fetch(`/api/account/activity?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as {
        events: ActivityEvent[];
        nextCursor: number | null;
        actors: ActivityActor[];
      };
    },
    [category, actorId, term],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    fetchPage()
      .then((data) => {
        if (!alive) return;
        setEvents(data.events);
        setNextCursor(data.nextCursor);
        if (data.actors.length > 0) setActors(data.actors);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(nextCursor);
      setEvents((prev) => [...prev, ...data.events]);
      setNextCursor(data.nextCursor);
    } catch {
      // Keep the rows we already have; the button stays available.
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, nextCursor]);

  const refresh = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchPage()
      .then((data) => {
        setEvents(data.events);
        setNextCursor(data.nextCursor);
        if (data.actors.length > 0) setActors(data.actors);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [fetchPage]);

  const groups = useMemo(() => groupByDay(events), [events]);

  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [locale],
  );
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  function dayLabel(day: string): string {
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
    if (day === key(today)) return t('today');
    if (day === key(yesterday)) return t('yesterday');
    return dayFormatter.format(new Date(`${day}T12:00:00`));
  }

  function actionLabel(event: ActivityEvent): string {
    const key = actionKey(event.action);
    if (t.has(key)) return t(key);
    // New action shipped in SQL but not yet translated: show the raw
    // verb rather than a blank row.
    return event.action;
  }

  function fieldLabel(column: string): string {
    const key = fieldKey(column);
    if (t.has(key)) return t(key);
    return column.replace(/_/g, ' ');
  }

  function valueLabel(value: unknown): string {
    const kind = valueKind(value);
    if (kind === 'empty') return '—';
    if (kind === 'boolean') return value ? t('yes') : t('no');
    if (kind === 'role' && tRoles.has(String(value))) return tRoles(String(value));
    return previewValue(value);
  }

  function actorName(id: string): string | null {
    if (id === 'all') return null;
    const found = actors.find((a) => a.id === id);
    return found?.name ?? found?.email ?? null;
  }

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {t('refresh')}
          </Button>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            active={category === 'all'}
            onClick={() => setCategory('all')}
          >
            {t('allCategories')}
          </FilterChip>
          {ACTIVITY_CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              active={category === c}
              onClick={() => setCategory(c)}
            >
              {t(`categories.${c}`)}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="ps-9"
              aria-label={t('searchPlaceholder')}
            />
          </div>
          <Select value={actorId} onValueChange={(next) => setActorId(next ?? 'all')}>
            <SelectTrigger className="bg-muted border-border text-foreground sm:w-56">
              <SelectValue>{actorName(actorId) ?? t('allActors')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allActors')}</SelectItem>
              {actors
                .filter((a) => a.id)
                .map((a) => (
                  <SelectItem key={a.id!} value={a.id!}>
                    {a.name || a.email || a.id!.slice(0, 8)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="border-border bg-card flex items-center justify-center gap-2 rounded-xl border p-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : failed ? (
        <div className="border-border bg-card rounded-xl border p-10 text-center text-sm text-muted-foreground">
          {t('loadFailed')}
        </div>
      ) : events.length === 0 ? (
        <div className="border-border bg-card flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <History className="text-muted-foreground/60 size-6" />
          <p className="text-foreground text-sm font-medium">{t('empty')}</p>
          <p className="text-muted-foreground max-w-[46ch] text-xs">
            {t('emptyHint')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.day}>
              <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.09em] uppercase">
                {dayLabel(group.day)}
              </h3>
              <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-xl border">
                {group.events.map((event) => {
                  const Icon = CATEGORY_ICON[event.category] ?? History;
                  const destructive = isDestructive(event.action);
                  const { entries, hidden } = visibleChanges(
                    event.changes,
                    INLINE_CHANGES,
                  );

                  return (
                    <li key={event.id} className="flex gap-3 px-4 py-3">
                      <span
                        className={cn(
                          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                          destructive
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-primary-soft text-primary',
                        )}
                      >
                        <Icon className="size-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="text-foreground text-sm font-medium">
                            {actionLabel(event)}
                          </span>
                          {event.target_label ? (
                            <span
                              dir="auto"
                              title={event.target_label}
                              className="text-muted-foreground max-w-[28ch] truncate text-xs"
                            >
                              {`«${event.target_label}»`}
                            </span>
                          ) : null}
                          {event.source === 'system' ? (
                            <SettingsChip variant="muted" className="ms-1">
                              {t('system')}
                            </SettingsChip>
                          ) : null}
                        </div>

                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="text-foreground/80 inline-flex items-center gap-1.5 font-medium">
                            <span
                              aria-hidden
                              className="bg-primary-soft text-primary ring-primary-soft-2 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-1"
                            >
                              {initials(event.actor_name, event.actor_email)}
                            </span>
                            <span dir="auto">
                              {event.actor_name ||
                                event.actor_email ||
                                t('unknownActor')}
                            </span>
                          </span>
                          {event.actor_role && tRoles.has(event.actor_role) ? (
                            <span>· {tRoles(event.actor_role)}</span>
                          ) : null}
                          <span aria-hidden>·</span>
                          <time dateTime={event.created_at}>
                            {timeFormatter.format(new Date(event.created_at))}
                          </time>
                        </div>

                        {entries.length > 0 ? (
                          <div className="mt-2 flex flex-col gap-1">
                            {entries.map(([column, change]) => {
                              const kind = valueKind(change.to);
                              return (
                                <div
                                  key={column}
                                  className="bg-muted/50 flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
                                >
                                  <span className="text-muted-foreground font-medium">
                                    {fieldLabel(column)}
                                  </span>
                                  {kind === 'secret' ? (
                                    <span className="text-muted-foreground inline-flex items-center gap-1">
                                      <Lock className="size-3" />
                                      {t('hiddenValue')}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                                        {valueLabel(change.from)}
                                      </span>
                                      <span
                                        aria-hidden
                                        className="text-muted-foreground/80 inline-block rtl:rotate-180"
                                      >
                                        →
                                      </span>
                                      <span
                                        dir="auto"
                                        className="text-foreground font-medium"
                                      >
                                        {valueLabel(change.to)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                            {hidden > 0 ? (
                              <span className="text-muted-foreground text-[11px]">
                                {t('moreChanges', { count: hidden })}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {nextCursor ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center"
            >
              {loadingMore ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {t('loadMore')}
            </Button>
          ) : (
            <p className="text-muted-foreground self-center text-[11px]">
              {t('endOfLog')}
            </p>
          )}
        </div>
      )}

      <p className="text-muted-foreground mt-5 flex items-center gap-1.5 text-[11px]">
        <UserCog className="size-3.5" />
        {t('footer')}
      </p>
    </div>
  );

}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary-soft-2 bg-primary-soft text-primary'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
