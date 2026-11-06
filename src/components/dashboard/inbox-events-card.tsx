'use client';

// ============================================================
// InboxEventsCard — dashboard widget for the INBOX side of the
// account activity log.
//
// The operator log (ChangesCard) answers "who changed the system".
// This card answers "what happened to conversations": assignment
// changes and status transitions. They used to share one timeline,
// which meant a busy inbox buried every settings change; the two
// scopes are read separately now, and the dashboard shows them side
// by side.
//
// Same gates as ChangesCard, deliberately:
//   * plan — `audit_log` (CORE has no trail),
//   * role — admin+ only,
//   * server — `/api/account/activity` re-checks both.
// A closed gate renders nothing instead of a dead tile.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Inbox, Loader2 } from 'lucide-react';

import { FeatureGate } from '@/components/plans/feature-gate';
import { useAuth } from '@/hooks/use-auth';
import {
  actionKey,
  valueLabelKey,
  type ActivityChange,
  type ActivityEvent,
} from '@/lib/audit/activity';

const ROW_LIMIT = 6;

export function InboxEventsCard() {
  const { canManageMembers } = useAuth();

  if (!canManageMembers) return null;

  return (
    <FeatureGate feature="audit_log">
      <InboxEventsCardBody />
    </FeatureGate>
  );
}

function InboxEventsCardBody() {
  const t = useTranslations('Dashboard.inboxEvents');
  const tActivity = useTranslations('Settings.activity');
  const locale = useLocale();

  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/account/activity?limit=${ROW_LIMIT}&scope=inbox`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: ActivityEvent[] };
      setEvents(data.events);
      setFailed(false);
    } catch {
      // A closed gate (402/403) is not an error the dashboard should
      // shout about: the card simply stays quiet.
      setFailed(true);
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const time = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const date = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    day: 'numeric',
    month: 'short',
  });

  function when(iso: string): string {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? time.format(d) : date.format(d);
  }

  function label(event: ActivityEvent): string {
    const key = actionKey(event.action);
    return tActivity.has(key) ? tActivity(key) : event.action;
  }

  function statusName(column: string, value: unknown): string {
    const named = valueLabelKey(column, value);
    if (named && tActivity.has(named)) return tActivity(named);
    return typeof value === 'string' ? value : '—';
  }

  // "مفتوحة ← مغلقة" tells the reader what actually changed; the action
  // name alone ("تغيّرت حالة المحادثة") does not.
  function transition(event: ActivityEvent): string | null {
    const change = (event.changes as Record<string, ActivityChange> | null)
      ?.status;
    if (!change) return null;
    return `${statusName('status', change.from)} ← ${statusName('status', change.to)}`;
  }

  return (
    <section className="border-border bg-card flex h-full flex-col rounded-xl border p-4">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Inbox className="text-muted-foreground size-4" />
            {t('title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('description')}
          </p>
        </div>
        <Link
          href="/settings?tab=activity&scope=inbox"
          className="text-primary inline-flex shrink-0 items-center gap-0.5 text-xs font-medium hover:underline"
        >
          {t('open')}
          <ArrowUpRight className="size-3.5" />
        </Link>
      </header>

      {events === null ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 py-6 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          {t('loading')}
        </div>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground flex-1 py-6 text-center text-xs">
          {failed ? t('unavailable') : t('empty')}
        </p>
      ) : (
        <ul className="divide-border -mx-1 flex-1 divide-y">
          {events.map((event) => {
            const moved = transition(event);
            return (
              <li key={event.id} className="flex items-center gap-2.5 px-1 py-2">
                <span className="bg-primary-soft text-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
                  <Inbox className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-xs font-medium">
                    {label(event)}
                    {event.target_label ? (
                      <span
                        dir="auto"
                        className="text-muted-foreground font-normal"
                      >
                        {' '}
                        {`«${event.target_label}»`}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground truncate text-[11px]">
                    {moved ? (
                      <>
                        <span dir="auto">{moved}</span>
                        {' · '}
                      </>
                    ) : null}
                    <span dir="auto">
                      {event.actor_name ||
                        event.actor_email ||
                        (event.source === 'system'
                          ? tActivity('system')
                          : t('unknownActor'))}
                    </span>
                    {' · '}
                    {when(event.created_at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
