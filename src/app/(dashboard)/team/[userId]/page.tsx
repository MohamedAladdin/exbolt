"use client";

// ============================================================
// /team/[userId] — one member's KPIs
//
// Reachable from the dashboard team card, the settings member list and
// the sender name under an outbound bubble. Everything comes from the
// `member_profile` RPC (migration 080) so the numbers are computed once,
// server-side, over the same `turns` definition the dashboard uses.
//
// Privacy is enforced in the RPC: an agent can open their own profile,
// only owner/admin can open a colleague's.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Target,
  TriangleAlert,
  UserRound,
  UsersRound,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PresenceDot } from "@/components/presence/presence-dot";

type Range = 7 | 30 | 90;

interface MemberProfileResponse {
  member: {
    userId: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    role: string | null;
    presence: "online" | "away" | null;
    lastSeenAt: string | null;
  };
  range: { days: number; start: string; timezone: string };
  kpis: {
    replies: number;
    medianMinutes: number | null;
    p90Minutes: number | null;
    fastestMinutes: number | null;
    withinTarget: number;
    conversations: number;
    contacts: number;
    openAssigned: number;
    resolved: number;
    onlineMinutes: number;
    onlinePerDay: number;
    replyTarget: number;
    lastActivityAt: string | null;
  };
  daily: { date: string; replies: number; onlineMinutes: number }[];
}

const RANGES: Range[] = [7, 30, 90];

function hours(minutes: number | null | undefined): string {
  const m = Math.round(Number(minutes ?? 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function minutesLabel(value: number | null, locale: string): string {
  if (value == null) return "—";
  const m = Math.round(value);
  if (m < 60) return `${m} ${locale === "ar" ? "د" : "min"}`;
  return hours(m);
}

export default function TeamMemberPage() {
  const params = useParams<{ userId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const t = useTranslations("Team.profile");
  const locale = useLocale();
  const { accountId } = useAuth();

  const rawDays = Number(search.get("days"));
  const days: Range = RANGES.includes(rawDays as Range) ? (rawDays as Range) : 30;

  const [data, setData] = useState<MemberProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId || !params?.userId) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: result, error: rpcError } = await supabase.rpc(
      "member_profile",
      { p_user: params.userId, p_days: days, p_tz: "Africa/Cairo" },
    );
    if (rpcError) {
      setError(rpcError.message);
      setData(null);
    } else {
      setData(result as MemberProfileResponse);
    }
    setLoading(false);
  }, [accountId, params?.userId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmtDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Cairo",
      }),
    [locale],
  );

  const dayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
        day: "numeric",
        month: "short",
      }),
    [locale],
  );

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-10 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <TriangleAlert className="text-muted-foreground mx-auto size-7" />
        <p className="mt-3 text-sm font-medium">{t("unavailable")}</p>
        <p className="text-muted-foreground mt-1 text-xs">{t("unavailableHint")}</p>
        <Link
          href="/dashboard"
          className="text-primary mt-4 inline-flex items-center gap-1 text-sm underline"
        >
          <ArrowRight className="size-4" />
          {t("back")}
        </Link>
      </div>
    );
  }

  const { member, kpis, daily } = data;
  const initials = (member.name ?? member.email ?? "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  const peak = Math.max(1, ...daily.map((d) => d.onlineMinutes));
  const slaRate =
    kpis.replies > 0 ? Math.round((kpis.withinTarget / kpis.replies) * 100) : null;

  const kpiCards = [
    {
      key: "online",
      icon: Clock,
      label: t("kpi.online"),
      value: hours(kpis.onlineMinutes),
      hint: t("kpi.onlineHint", { perDay: hours(kpis.onlinePerDay) }),
    },
    {
      key: "replies",
      icon: MessageSquare,
      label: t("kpi.replies"),
      value: String(kpis.replies),
      hint: t("kpi.repliesHint", { conv: kpis.conversations }),
    },
    {
      key: "first",
      icon: Target,
      label: t("kpi.firstResponse"),
      value: minutesLabel(kpis.medianMinutes, locale),
      hint:
        kpis.p90Minutes != null
          ? t("kpi.firstResponseHint", { p90: minutesLabel(kpis.p90Minutes, locale) })
          : t("kpi.none"),
    },
    {
      key: "sla",
      icon: CheckCircle2,
      label: t("kpi.sla"),
      value: slaRate == null ? "—" : `${slaRate}%`,
      hint: t("kpi.slaHint", { target: kpis.replyTarget }),
    },
    {
      key: "contacts",
      icon: UsersRound,
      label: t("kpi.contacts"),
      value: String(kpis.contacts),
      hint: t("kpi.contactsHint"),
    },
    {
      key: "resolved",
      icon: UserRound,
      label: t("kpi.resolved"),
      value: String(kpis.resolved),
      hint: t("kpi.resolvedHint", { open: kpis.openAssigned }),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-1">
      <Link
        href="/dashboard"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        <ArrowRight className="size-3.5 rotate-180" />
        {t("back")}
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-muted text-foreground flex size-14 items-center justify-center overflow-hidden rounded-full text-lg font-semibold">
              {member.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={member.avatarUrl}
                  alt=""
                  className="size-14 object-cover"
                />
              ) : (
                initials || "?"
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold">
                  {member.name ?? member.email ?? t("unnamed")}
                </h1>
                <PresenceDot status={member.presence ?? "offline"} />
              </div>
              <p className="text-muted-foreground truncate text-xs">
                {member.email}
                {member.role ? ` · ${member.role}` : ""}
              </p>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                {kpis.lastActivityAt
                  ? t("lastActivity", { when: fmtDate.format(new Date(kpis.lastActivityAt)) })
                  : t("noActivity")}
              </p>
            </div>
          </div>

          <div className="border-border flex items-center gap-1 rounded-lg border p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => router.replace(`/team/${params.userId}?days=${r}`)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  r === days
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t("days", { days: r })}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpiCards.map((kpi) => (
          <Card key={kpi.key}>
            <CardContent className="p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <kpi.icon className="size-3.5" />
                {kpi.label}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">
                {kpi.value}
              </div>
              <div className="text-muted-foreground mt-1 text-[11px]">
                {kpi.hint}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("chartTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {daily.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-xs">
              {t("chartEmpty")}
            </p>
          ) : (
            <div className="flex h-40 items-end gap-1">
              {daily.map((d) => {
                const height = Math.round((d.onlineMinutes / peak) * 100);
                return (
                  <div
                    key={d.date}
                    className="group relative flex h-full flex-1 flex-col justify-end"
                    title={`${dayLabel.format(new Date(`${d.date}T12:00:00Z`))} · ${hours(
                      d.onlineMinutes,
                    )} · ${d.replies}`}
                  >
                    <div
                      className="bg-primary/70 group-hover:bg-primary w-full rounded-t-[2px] transition-colors"
                      style={{ height: `${Math.max(height, d.onlineMinutes > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-muted-foreground mt-2 flex justify-between text-[10px]">
            <span>{daily[0] ? dayLabel.format(new Date(`${daily[0].date}T12:00:00Z`)) : ""}</span>
            <span>{t("chartLegend")}</span>
            <span>
              {daily.length
                ? dayLabel.format(new Date(`${daily[daily.length - 1].date}T12:00:00Z`))
                : ""}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
