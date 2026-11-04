"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_PAGE_SIZE,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import type { InboxFilter } from "@/lib/inbox/inbox-filters";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, X, Phone, UserRound } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChannelBadge, ChannelAvatarDot, CHANNEL_VISUAL } from "./channel-badge";
import { CHANNELS, toChannel, type Channel } from "@/lib/channels/types";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  initialFilter?: InboxFilter;
  /**
   * The account's WhatsApp numbers (multi-number). Empty/absent means
   * "one number or none", and the number filter row stays hidden.
   */
  numbers?: InboxNumberOption[];
  /**
   * Deep-link filter from a member's profile card
   * (`/inbox?assignee=<userId>`): show only threads assigned to them.
   */
  assignee?: { id: string; name: string | null } | null;
  onClearAssignee?: () => void;
  /**
   * Deep-link filter from the member's replies card
   * (`/inbox?participant=<userId>&days=<n>`). `ids` is the exact set the
   * profile counted (member_conversation_ids); null while it loads.
   */
  participant?: {
    id: string;
    name: string | null;
    days: number;
  } | null;
  onClearParticipant?: () => void;
}

/** Minimal shape the inbox needs to filter by number. */
export interface InboxNumberOption {
  id: string;
  display_phone_number: string | null;
  verified_name: string | null;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};


export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  initialFilter = "all",
  numbers = [],
  assignee = null,
  onClearAssignee,
  participant = null,
  onClearParticipant,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  
  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterWaiting"), value: "waiting" },
    { label: t("filterUnassigned"), value: "unassigned" },
    { label: t("filterExpiring"), value: "expiring" },
    { label: t("filterOpen"), value: "open" },
    { label: t("filterPending"), value: "pending" },
    { label: t("filterClosed"), value: "closed" },
  ], [t]);

  const [search, setSearch] = useState("");
  // Debounced copy: every keystroke must not become a query.
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  // Server-side results: the rows of the current page(s), the exact size of
  // the filtered set, and the account-level chip counts.
  const [rows, setRows] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<{
    total: number;
    /** Per-filter counts under the active narrow set (migration 091) — the
     *  number beside a filter is the number of rows clicking it returns. */
    filters?: Partial<Record<InboxFilter, number>>;
    channels: Record<string, number>;
    numbers: Record<string, number>;
    companies: string[];
  } | null>(null);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  // Channel filter (migration 060). 'all' keeps the historical behaviour;
  // picking a channel narrows the list to threads that arrived on it, so
  // a shared inbox with WhatsApp + Messenger + Instagram stays readable.
  const [channelFilter, setChannelFilter] = useState<"all" | Channel>("all");
  // Number filter (migration 075): which WhatsApp number a thread belongs
  // to. 'all' is the historical view; only rendered when the account has
  // more than one number.
  const [numberFilter, setNumberFilter] = useState<string>("all");

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  // Filters are applied by `inbox_page` in the database, so the list never
  // argues with the chips: search, status, channel, number, assignee,
  // participant, tags and company all narrow the query, and the response
  // carries the exact total for the same predicate.
  const filtersKey = useMemo(
    () =>
      JSON.stringify([
        searchQuery,
        filter,
        channelFilter,
        numberFilter,
        selectedTagIds,
        selectedCompany,
        assignee?.id ?? null,
        participant?.id ?? null,
        participant?.days ?? null,
      ]),
    [
      searchQuery,
      filter,
      channelFilter,
      numberFilter,
      selectedTagIds,
      selectedCompany,
      assignee?.id,
      participant?.id,
      participant?.days,
    ],
  );

  const fetchPage = useCallback(
    async (offset: number, limit: number = CONVERSATION_PAGE_SIZE) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("inbox_page", {
        p_limit: limit,
        p_offset: offset,
        p_search: searchQuery || null,
        p_filter: filter,
        p_channel: channelFilter === "all" ? null : channelFilter,
        p_number: numberFilter === "all" ? null : numberFilter,
        p_assignee: assignee?.id ?? null,
        p_participant: participant?.id ?? null,
        p_participant_days: participant?.days ?? 30,
        p_tag_ids: selectedTagIds.length ? selectedTagIds : null,
        p_company: selectedCompany,
        p_tz: "Africa/Cairo",
      });
      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return null;
      }
      const payload = data as {
        total: number;
        rows: Parameters<typeof normalizeConversations>[0];
        counts: {
          total: number;
          filters?: Partial<Record<InboxFilter, number>>;
          channels: Record<string, number>;
          numbers: Record<string, number>;
          companies: string[];
        };
      } | null;
      if (!payload) return null;
      return {
        total: Number(payload.total ?? 0),
        rows: normalizeConversations(payload.rows ?? []),
        counts: payload.counts,
      };
    },
    [
      searchQuery,
      filter,
      channelFilter,
      numberFilter,
      selectedTagIds,
      selectedCompany,
      assignee?.id,
      participant?.id,
      participant?.days,
    ],
  );

  // Any filter change resets the window: page 1 of the NEW predicate, which
  // is the only way "search" can cover threads that were never loaded.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const page = await fetchPage(0);
      if (cancelled) return;
      if (page) {
        setRows(page.rows);
        setTotal(page.total);
        setCounts(page.counts ?? null);
        onConversationsLoadedRef.current(page.rows);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, filtersKey]);

  // Soft refresh (tab focus / realtime reconnect): re-read EVERY row that is
  // on screen, in 200-row chunks, and swap the list. Re-reading only page 1
  // left threads further down stale whenever the realtime event was missed.
  const resyncRef = useRef(resyncToken);
  useEffect(() => {
    if (resyncToken === resyncRef.current) return;
    resyncRef.current = resyncToken;
    void (async () => {
      const want = Math.max(rows.length, CONVERSATION_PAGE_SIZE);
      const collected: Conversation[] = [];
      let offset = 0;
      while (offset < want) {
        const page = await fetchPage(offset, 200);
        if (!page) return;
        collected.push(...page.rows);
        setTotal(page.total);
        setCounts(page.counts ?? null);
        if (page.rows.length === 0 || collected.length >= page.total) break;
        offset += page.rows.length;
      }
      setRows(collected);
    })();
    // `rows.length` is deliberately read at fire time (ref-like): re-running
    // this effect whenever a page loads would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, resyncToken]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || rows.length >= total) return;
    setLoadingMore(true);
    const page = await fetchPage(rows.length);
    if (page) {
      setRows((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...page.rows.filter((c) => !seen.has(c.id))];
      });
      setTotal(page.total);
    }
    setLoadingMore(false);
  }, [fetchPage, loading, loadingMore, rows.length, total]);

  // "Load all": walk the rest of the filtered set in 200-row chunks. The RPC
  // caps a page at 200, so a 1.4k-thread inbox is ~7 requests instead of 56.
  const loadAll = useCallback(async () => {
    if (loadingAll || loading || rows.length >= total) return;
    setLoadingAll(true);
    let acc = [...rows];
    const seen = new Set(acc.map((c) => c.id));
    let offset = acc.length;
    while (offset < total) {
      const page = await fetchPage(offset, 200);
      if (!page) break;
      for (const conv of page.rows) {
        if (!seen.has(conv.id)) {
          seen.add(conv.id);
          acc.push(conv);
        }
      }
      setRows([...acc]);
      setTotal(page.total);
      if (page.rows.length === 0) break;
      offset = acc.length;
    }
    setLoadingAll(false);
  }, [fetchPage, loading, loadingAll, rows, total]);

  const hasMore = rows.length < total;

  // Scroll trigger: a sentinel at the end of the list, one page ahead of the
  // fold. The button below it is the fallback when it never intersects.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "240px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options come from the account (served with every page), not
  // from whatever happens to be loaded — a filter must never offer a
  // partial list of the values that exist.
  const companies = useMemo(
    () => counts?.companies ?? [],
    [counts],
  );

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);


  /**
   * Per-channel counts for the filter chips — from the account, so they are
   * the same numbers whether one page or forty are loaded.
   */
  const channelCounts = useMemo(() => {
    const api = counts?.channels ?? {};
    return {
      all: counts?.total ?? 0,
      whatsapp: Number(api.whatsapp ?? 0),
      messenger: Number(api.messenger ?? 0),
      instagram: Number(api.instagram ?? 0),
    } as Record<"all" | Channel, number>;
  }, [counts]);

  // Only worth showing when the account actually runs more than one
  // transport — a WhatsApp-only workspace keeps the original single row.
  /** Per-filter counts, computed server-side over the same narrow set. */
  const filterCounts = useMemo<Partial<Record<InboxFilter, number>>>(
    () => counts?.filters ?? {},
    [counts],
  );

  const activeChannels = CHANNELS.filter((ch) => channelCounts[ch] > 0);
  const showChannelFilter = activeChannels.length > 1;

  // ---- numbers (multi-number accounts) --------------------------
  // Last four digits are the only thing that distinguishes two numbers
  // at a glance; the full number lives in the title/aria-label.
  const numberByLast4 = useMemo(() => {
    const map = new Map<string, InboxNumberOption>();
    for (const n of numbers) map.set(n.id, n);
    return map;
  }, [numbers]);

  const last4 = useCallback((n: InboxNumberOption) => {
    const digits = (n.display_phone_number ?? "").replace(/\D/g, "");
    return digits.slice(-4) || n.id.slice(-4);
  }, []);

  const numberCounts = useMemo(() => {
    const api = counts?.numbers ?? {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(api)) out[k] = Number(v);
    return out;
  }, [counts]);

  const showNumberFilter = numbers.length > 1;

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters = selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const hasActiveFilters =
    searchQuery !== "" ||
    filter !== "all" ||
    channelFilter !== "all" ||
    numberFilter !== "all" ||
    selectedTagIds.length > 0 ||
    selectedCompany !== null ||
    assignee !== null ||
    participant !== null;

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="relative flex h-full w-full flex-col border-e border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="shrink-0 space-y-2.5 border-b border-border bg-card p-3">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted ps-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        {/* Search runs against the whole table, so the honest answer to "how
            many matched" is the server's total — show it instead of letting
            the operator guess from a scrolling list. */}
        {hasActiveFilters && !loading && (
          <div className="text-muted-foreground px-1 text-[11px] tabular-nums">
            {t("resultsCount", { count: total })}
          </div>
        )}

        {showNumberFilter && (
          <div
            role="tablist"
            aria-label={t("numberFilterLabel")}
            className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <span className="inline-flex shrink-0 items-center gap-1 pe-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
              <Phone className="h-3 w-3" aria-hidden />
              {t("numberLabel")}
            </span>
            <button
              type="button"
              role="tab"
              aria-selected={numberFilter === "all"}
              onClick={() => setNumberFilter("all")}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                numberFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t("allNumbers")}
            </button>
            {numbers.map((n) => {
              const isActive = numberFilter === n.id;
              const label = n.verified_name
                ? `${n.verified_name} · …${last4(n)}`
                : `…${last4(n)}`;
              return (
                <button
                  key={n.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`${n.display_phone_number ?? n.id} (${numberCounts[n.id] ?? 0})`}
                  title={`${n.display_phone_number ?? n.id} · ${n.verified_name ?? ""}`}
                  onClick={() => setNumberFilter(n.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span dir="ltr" className="tabular-nums">
                    {last4(n)}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums text-[10px]",
                      isActive ? "opacity-80" : "opacity-60",
                    )}
                  >
                    {numberCounts[n.id] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {showChannelFilter && (
          <div
            role="tablist"
            aria-label={t("channelFilterLabel")}
            className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={channelFilter === "all"}
              onClick={() => setChannelFilter("all")}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                channelFilter === "all"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t("allChannels")}
            </button>
            {activeChannels.map((ch) => {
              const { Icon, label } = CHANNEL_VISUAL[ch];
              const isActive = channelFilter === ch;
              return (
                <button
                  key={ch}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`${label} (${channelCounts[ch]})`}
                  title={`${label} (${channelCounts[ch]})`}
                  onClick={() => setChannelFilter(ch)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors",
                    isActive
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                  <span className="tabular-nums">{channelCounts[ch]}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                {typeof filterCounts[filter] === "number" && (
                  <span className="tabular-nums text-[10px] text-muted-foreground/80">
                    {filterCounts[filter]}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "justify-between gap-6 text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {/* nowrap: a long label ("نافذة الرد تُغلق") used to wrap to
                      two lines and leave its count floating mid-row. */}
                  <span className="whitespace-nowrap">{opt.label}</span>
                  {typeof filterCounts[opt.value] === "number" && (
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                      {filterCounts[opt.value]}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Always shown, even for a single company: hiding the control made
              the row change shape between accounts and looked like a bug. */}
          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {assignee && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={onClearAssignee}
              title={t("clearAssignee")}
              className="bg-primary/15 text-foreground hover:bg-primary/25 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            >
              <UserRound className="h-3 w-3" />
              <span className="max-w-40 truncate">
                {t("assignedTo", { name: assignee.name ?? "—" })}
              </span>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {participant && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={onClearParticipant}
              title={t("clearAssignee")}
              className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            >
              <UserRound className="h-3 w-3" />
              <span className="max-w-40 truncate">
                {t("participatedIn", { name: participant.name ?? "—" })}
              </span>
              <span dir="ltr" className="text-muted-foreground tabular-nums">
                · {participant.days}d
              </span>
              <span className="text-muted-foreground tabular-nums">
                ({total})
              </span>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : total === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
            {/* A filter can be satisfied only by threads further down the
                table; with 25-row pages that reads as "no results" until the
                operator asks for more. Say so instead of lying. */}
            {hasMore && (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="text-primary mt-3 text-[11px] underline-offset-2 hover:underline"
              >
                {t("loadMore")}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {rows.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
                numberBadge={
                  showNumberFilter && conv.whatsapp_config_id
                    ? (() => {
                        const n = numberByLast4.get(conv.whatsapp_config_id);
                        return n ? `· ${last4(n)}` : null;
                      })()
                    : null
                }
              />
            ))}
            {hasMore && (
              <div
                ref={sentinelRef}
                className="flex flex-col items-center justify-center gap-1.5 py-4"
              >
                {loadingMore ? (
                  <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
                    <span className="border-primary h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" />
                    {t("loadingMore")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    className="text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline"
                  >
                    {t("loadMore")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Floating "load all" — the inline one was impossible to hit because
          scrolling keeps pulling the next page under the cursor. It appears
          after two pages (so the first screen stays clean) and only while
          there is something left to load. */}
      {hasMore && rows.length >= CONVERSATION_PAGE_SIZE * 2 && (
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loadingAll}
          className="bg-foreground text-background absolute bottom-4 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-2 text-[11px] font-medium shadow-lg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loadingAll
            ? t("loadingAll")
            : `${t("loadAll")} · ${total.toLocaleString("en-US")}`}
        </button>
      )}
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  /** e.g. "…9292" when the account has more than one number. */
  numberBadge?: string | null;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
  numberBadge = null,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-start transition-colors hover:bg-muted/50",
        isActive && "border-s-2 border-primary bg-muted/70"
      )}
    >
      {/* Avatar. `relative` anchors the channel dot for the non-WhatsApp
          channels — the one cue that tells a Messenger thread from a
          WhatsApp one at a glance. */}
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
        <ChannelAvatarDot channel={conversation.channel ?? contact?.channel} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
            {toChannel(conversation.channel ?? contact?.channel) !== "whatsapp" && (
              <ChannelBadge
                channel={conversation.channel ?? contact?.channel}
                size="xs"
                className="shrink-0"
              />
            )}

          </span>
          <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground sm:text-[10px]">{timeAgo}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {numberBadge && (
              <span
                dir="ltr"
                className="text-[10px] leading-4 tabular-nums text-muted-foreground/60"
              >
                {numberBadge}
              </span>
            )}
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
