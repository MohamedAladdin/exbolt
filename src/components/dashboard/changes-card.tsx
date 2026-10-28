'use client';

// ============================================================
// ChangesCard — dashboard widget for the account activity log.
//
// The dashboard already answers "what is happening with customers"
// (ActivityFeed). This card answers the other question: "who changed
// the system". It is the same data as Settings → Activity log, six
// rows deep, so an admin who never opens settings still sees a
// colleague rotate a token or flip a role.
//
// Gated three times, deliberately:
//   * plan — `audit_log` (CORE has no trail),
//   * role — admin+ only,
//   * server — `/api/account/activity` re-checks both, so a tampered
//     client gets 402/403 and not data.
// When the gate is closed the card renders nothing rather than an
// empty shell, so the dashboard grid does not carry a dead tile.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowUpRight,
  FileText,
  History,
  Inbox,
  Loader2,
  PlugZap,
  Settings2,
  UsersRound,
  Zap,
} from 'lucide-react';

import { FeatureGate } from '@/components/plans/feature-gate';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  actionKey,
  isDestructive,
  type ActivityCategory,
  type ActivityEvent,
} from '@/lib/audit/activity';

const ROW_LIMIT = 6;

const CATEGORY_ICON: Record<ActivityCategory, typeof History> = {
  members: UsersRound,
  settings: Settings2,
  integrations: PlugZap,
  content: FileText,
  automations: Zap,
  inbox: Inbox,
};

export function ChangesCard() {
  const { canManageMembers } = useAuth();

  if (!canManageMembers) return null;

  return (
    <FeatureGate feature="audit_log">
      <ChangesCardBody />
    </FeatureGate>
  );
}

function ChangesCardBody() {
  const t = useTranslations('Dashboard.changes');
  const tActivity = useTranslations('Settings.activity');
  const locale = useLocale();

  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/account/activity?limit=${ROW_LIMIT}`, {
        cache: 'no-store',
      });
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

  return (
    <section className="border-border bg-card flex h-full flex-col rounded-xl border p-4">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <History className="text-muted-foreground size-4" />
            {t('title')}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t('description')}</p>
        </div>
        <Link
          href="/settings?tab=activity"
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
            const Icon = CATEGORY_ICON[event.category] ?? History;
            const destructive = isDestructive(event.action);
            return (
              <li key={event.id} className="flex items-center gap-2.5 px-1 py-2">
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-lg',
                    destructive
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-primary-soft text-primary',
                  )}
                >
                  <Icon className="size-3.5" />
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
