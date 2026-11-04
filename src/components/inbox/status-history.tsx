"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { STATUS_REASON_KEYS } from "@/lib/audit/activity";
import type { ConversationStatus } from "@/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The thread's status history (migration 091).
 *
 * A status is a state; a history is the answer to "who closed this, when, and
 * why" — which is the question an operations lead actually asks. Rows are
 * written by a Postgres trigger on every transition (person / system), so the
 * timeline cannot be missing a path: manual, sweep, inbound, outbound,
 * automation and API all land here.
 *
 * Paid feature (`audit_log`, Growth+): the surrounding UI hides it for CORE
 * with `FeatureGate`. The table itself is readable by any member — the gate is
 * the product decision, not a security boundary.
 */

type StatusEvent = {
  id: number;
  from_status: ConversationStatus | null;
  to_status: ConversationStatus;
  actor_name: string | null;
  actor_user_id: string | null;
  source: "app" | "system";
  reason: string;
  created_at: string;
};

const TONE: Record<ConversationStatus, string> = {
  open: "text-primary",
  pending: "text-amber-400",
  closed: "text-muted-foreground",
};

export function StatusHistory({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const t = useTranslations("Inbox.messageThread");
  const tList = useTranslations("Inbox.conversationList");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<StatusEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversation_status_events")
      .select("id, from_status, to_status, actor_name, actor_user_id, source, reason, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(30);
    if (error) {
      setFailed(true);
    } else {
      setEvents((data ?? []) as StatusEvent[]);
    }
    setLoading(false);
  }, [conversationId]);

  // Refetch every time it opens: a reply may have reopened the thread a second
  // ago, and a stale timeline is worse than none on an audit surface.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const statusLabel = (status: ConversationStatus | null) =>
    status === "open"
      ? tList("filterOpen")
      : status === "pending"
        ? tList("filterPending")
        : status === "closed"
          ? tList("filterClosed")
          : "—";

  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return iso.slice(0, 16).replace("T", " ");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("statusHistory")}
        title={t("statusHistory")}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className,
        )}
      >
        <History className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{t("statusHistory")}</p>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        {!loading && failed && (
          <p className="text-xs text-muted-foreground">{t("statusHistoryFailed")}</p>
        )}

        {!loading && !failed && events !== null && events.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("statusHistoryEmpty")}</p>
        )}

        {events !== null && events.length > 0 && (
          <ol className="max-h-72 space-y-2 overflow-y-auto pe-1">
            {events.map((event) => {
              const actor =
                event.source === "system"
                  ? t("statusActorSystem")
                  : (event.actor_name?.trim() || t("statusActorUnknown"));
              return (
                <li key={event.id} className="rounded-md border border-border/60 p-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">{statusLabel(event.from_status)}</span>
                    <span className="text-muted-foreground/60">←</span>
                    <span className={cn("font-medium", TONE[event.to_status])}>
                      {statusLabel(event.to_status)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="text-foreground/80">{actor}</span>
                    {" · "}
                    {t(STATUS_REASON_KEYS[event.reason] ?? "reasonManual")}
                    {" · "}
                    <span className="tabular-nums">{when(event.created_at)}</span>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
