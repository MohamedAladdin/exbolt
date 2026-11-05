"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  CONVERSATION_PAGE_SIZE,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import {
  DEFAULT_INBOX_FILTER,
  parseInboxFilter,
  type InboxFilter,
} from "@/lib/inbox/inbox-filters";
import { cn } from "@/lib/utils";
import type { AccountMember, Conversation, ConversationStatus, Tag } from "@/types";
import { Search, X, Clock, SlidersHorizontal, ArrowUp, Users, Settings2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchAccountMembers, memberLabel } from "@/lib/account/members";
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
  /** Raw `?filter=` from the URL. Absent → the account's own default
   *  (`accounts.default_inbox_filter`), falling back to «مفتوحة». */
  initialFilter?: string | null;
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
  /** Pick the member whose assigned threads to show, or null for anyone. */
  onSelectAssignee?: (id: string | null) => void;
  /** Clear both member views in one navigation (the funnel's clear-all). */
  onClearDeepLinks?: () => void;
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
  /** Pick the member whose replies the list shows, change the window, or pass
   *  null to show everyone. The page owns the URL for it. */
  onSelectParticipant?: (next: { id: string; days: number } | null) => void;
}

/** Minimal shape the inbox needs to filter by number. */
export interface InboxNumberOption {
  id: string;
  display_phone_number: string | null;
  verified_name: string | null;
}

/** The tabs the list stays on. Every other filter is one click away behind the
 *  funnel: statuses are what an agent switches between all day, the rest are
 *  occasional narrowing. */
const STATUS_TABS: InboxFilter[] = ["all", "open", "pending", "closed", "followup"];
const QUICK_FILTERS: InboxFilter[] = ["unread", "waiting", "unassigned", "expiring"];

/** The reply windows a member profile can be looked at through. */
const PARTICIPANT_WINDOWS = [7, 30, 90];

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
  initialFilter = null,
  numbers = [],
  assignee = null,
  onSelectAssignee,
  onClearDeepLinks,
  participant = null,
  onSelectParticipant,
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

  // Search tuning (migration 109): a name/number search is a different
  // question from "where did anyone write this", so the operator picks.
  const [searchDays, setSearchDays] = useState(30);
  const [searchScope, setSearchScope] = useState<"all" | "name">("all");
  const [searchTuneOpen, setSearchTuneOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Debounced copy: every keystroke must not become a query.
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setSearchQuery(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  // Deep links win, then the account's choice, then «مفتوحة». The account
  // value arrives a beat later than the first paint, so the list starts on the
  // fallback and swaps as soon as it is known.
  const { accountId } = useAuth();
  const [filter, setFilter] = useState<InboxFilter>(
    parseInboxFilter(initialFilter ?? DEFAULT_INBOX_FILTER),
  );

  useEffect(() => {
    // A ?filter= in the URL is the caller's explicit choice (deep links from a
    // member card, from a notification) and must never be overridden.
    if (initialFilter || !accountId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient()
        .from("accounts")
        .select("default_inbox_filter")
        .eq("id", accountId)
        .maybeSingle();
      if (cancelled) return;
      const next = parseInboxFilter(
        (data as { default_inbox_filter?: string } | null)?.default_inbox_filter ??
          DEFAULT_INBOX_FILTER,
      );
      setFilter((current) => (current === next ? current : next));
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, initialFilter]);
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
  const [filtersOpen, setFiltersOpen] = useState(false);

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
        searchDays,
        searchScope,
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
      searchDays,
      searchScope,
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
        p_search_days: searchDays,
        p_search_scope: searchScope,
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

  // The floating actions follow the scroll direction: down reveals them
  // (that is when the operator wants "load all" or "back to top"), up hides
  // them again so they never sit on top of the thread they are reading.
  const panelRef = useRef<HTMLDivElement>(null);
  const [showFloating, setShowFloating] = useState(false);

  useEffect(() => {
    const root = panelRef.current;
    const el = root?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (!el) return;
    let last = el.scrollTop;
    const onScroll = () => {
      const y = el.scrollTop;
      if (y > last + 2 && y > 120) setShowFloating(true);
      else if (y < last - 2 || y <= 120) setShowFloating(false);
      last = y;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    const el = panelRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    el?.scrollTo({ top: 0, behavior: "smooth" });
    setShowFloating(false);
  }, []);

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

  /** The roster behind the «محادثات عضو» selector. Fetched the first time the
   *  funnel opens: the inbox itself does not need it. */
  const [members, setMembers] = useState<AccountMember[]>([]);
  useEffect(() => {
    if (!filtersOpen || members.length > 0) return;
    let cancelled = false;
    void fetchAccountMembers().then((list) => {
      if (!cancelled) setMembers(list);
    });
    return () => {
      cancelled = true;
    };
  }, [filtersOpen, members.length]);

  /** The member being viewed may have left the account since the link was
   *  made, so the current id is always an option even when the roster omits it. */
  const participantOptions = useMemo(() => {
    const opts = members.map((m) => ({ id: m.user_id, name: memberLabel(m) }));
    if (participant && !opts.some((o) => o.id === participant.id)) {
      opts.unshift({ id: participant.id, name: participant.name ?? participant.id });
    }
    return opts;
  }, [members, participant]);

  /** Same roster, same "the id on screen is always an option" rule. */
  const assigneeOptions = useMemo(() => {
    const opts = members.map((m) => ({ id: m.user_id, name: memberLabel(m) }));
    if (assignee && !opts.some((o) => o.id === assignee.id)) {
      opts.unshift({ id: assignee.id, name: assignee.name ?? assignee.id });
    }
    return opts;
  }, [members, assignee]);

  /** Filters that narrow the list but are not statuses — they live inside the
   *  funnel button, and this is the number on its badge. */
  const extraFilterCount =
    (channelFilter === "all" ? 0 : 1) +
    (numberFilter === "all" ? 0 : 1) +
    selectedTagIds.length +
    (selectedCompany ? 1 : 0) +
    (assignee ? 1 : 0) +
    (participant ? 1 : 0);

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
    <div
      ref={panelRef}
      className="relative flex h-full w-full flex-col border-e border-border bg-card lg:w-96"
    >
      {/* Search + filter.
          Three rows, always: the search box with one filter button, then the
          status tabs, then the quick filters as the same segmented control.
          Channel / number / tags / company / assignee stay inside the button —
          five stacked rows turned a 320px panel into a wall of chips, and
          every extra row pushed the actual conversations down. */}
      <div className="shrink-0 space-y-2 border-b border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder={t("searchPlaceholder")}
              className="border-border bg-muted ps-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
            />
          </div>

          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger
              aria-label={t("filtersLabel")}
              title={t("filtersLabel")}
              className={cn(
                "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors",
                extraFilterCount > 0
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {extraFilterCount > 0 && (
                <span className="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {extraFilterCount}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 gap-3 p-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{t("filtersLabel")}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("filtersHint")}
                </p>
              </div>

              {/* Whose replies the list is showing. The member profile links
                  here as `?participant=<userId>&days=<n>`, which used to be
                  visible only as a "1" on the funnel badge — the popover then
                  offered «مسح كل الفلاتر» and nothing to see or change. */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("participantFilterLabel")}
                </p>
                <select
                  value={participant?.id ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    onSelectParticipant?.(
                      id ? { id, days: participant?.days ?? 30 } : null,
                    );
                  }}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-foreground/30 focus:outline-none"
                >
                  <option value="">{t("allMembers")}</option>
                  {participantOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {participant && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">
                      {t("participantWindowLabel")}
                    </span>
                    {PARTICIPANT_WINDOWS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={participant.days === d}
                        onClick={() => onSelectParticipant?.({ id: participant.id, days: d })}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition-colors",
                          participant.days === d
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* The other half of the same idea: `?assignee=` was a badge
                  too. Both selects are account-scoped and can be on at once. */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("assigneeFilterLabel")}
                </p>
                <select
                  value={assignee?.id ?? ""}
                  onChange={(e) => onSelectAssignee?.(e.target.value || null)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-foreground/30 focus:outline-none"
                >
                  <option value="">{t("allAssignees")}</option>
                  {assigneeOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("channelFilterLabel")}
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setChannelFilter("all")}
                    aria-pressed={channelFilter === "all"}
                    className={cn(
                      "rounded-full border px-2 py-1 text-[11px] transition-colors",
                      channelFilter === "all"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t("allChannels")}
                  </button>
                  {activeChannels.map((ch) => {
                    const { Icon } = CHANNEL_VISUAL[ch];
                    const isActive = channelFilter === ch;
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => setChannelFilter(ch)}
                        aria-pressed={isActive}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors",
                          isActive
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="h-3 w-3" aria-hidden />
                        <span className="tabular-nums">{channelCounts[ch]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {showNumberFilter && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("numberFilterLabel")}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setNumberFilter("all")}
                      aria-pressed={numberFilter === "all"}
                      className={cn(
                        "rounded-full border px-2 py-1 text-[11px] transition-colors",
                        numberFilter === "all"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t("allNumbers")}
                    </button>
                    {numbers.map((n) => {
                      const isActive = numberFilter === n.id;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => setNumberFilter(n.id)}
                          aria-pressed={isActive}
                          title={`${n.display_phone_number ?? n.id} · ${n.verified_name ?? ""}`}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors",
                            isActive
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span dir="ltr" className="tabular-nums">{last4(n)}</span>
                          <span className="tabular-nums text-[10px] opacity-70">
                            {numberCounts[n.id] ?? 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {tags.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("tags")}
                  </p>
                  <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                    {tags.map((tag) => {
                      const isActive = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          aria-pressed={isActive}
                          className={cn(
                            "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors",
                            isActive
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="truncate">{tag.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {companies.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("company")}
                  </p>
                  <select
                    value={selectedCompany ?? ""}
                    onChange={(e) => setSelectedCompany(e.target.value || null)}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-foreground/30 focus:outline-none"
                  >
                    <option value="">{t("allCompanies")}</option>
                    {companies.map((co) => (
                      <option key={co} value={co}>
                        {co}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {extraFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setChannelFilter("all");
                    setNumberFilter("all");
                    setSelectedCompany(null);
                    setSelectedTagIds([]);
                    onClearDeepLinks?.();
                  }}
                  className="w-full rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {t("clearFilters")}
                </button>
              )}
            </PopoverContent>
          </Popover>

          {/* Search tuning — scope + window. Deliberately its own button: the
              filter popover answers "which threads", this answers "how hard
              should the search look". */}
          <Popover open={searchTuneOpen} onOpenChange={setSearchTuneOpen}>
            <PopoverTrigger
              aria-label={t("searchTuneLabel")}
              title={t("searchTuneLabel")}
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors",
                searchScope === "name" || searchDays !== 30
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <Settings2 className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 gap-3 p-3">
              <div className="grid gap-1.5">
                <p className="text-xs font-medium text-foreground">{t("searchScopeLabel")}</p>
                <div className="flex gap-1.5">
                  {(["all", "name"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setSearchScope(scope)}
                      className={cn(
                        "flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors",
                        searchScope === scope
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(scope === "all" ? "searchScopeAll" : "searchScopeName")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <p className="text-xs font-medium text-foreground">{t("searchDaysLabel")}</p>
                <div className="flex gap-1.5">
                  {[7, 30, 90, 365].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setSearchDays(days)}
                      className={cn(
                        "flex-1 rounded-md border px-1 py-1.5 text-xs transition-colors",
                        searchDays === days
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {days === 365 ? t("searchDaysYear") : `${days}`}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">{t("searchTuneHint")}</p>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Status tabs: one click, and the count the filter would return.
            Live counts are four digits (الكل 1522 · معلّقة 624), and the five
            chips are wider than the panel: a sideways scroll with a hidden
            scrollbar clipped «متابعة» down to a clock and one letter on
            desktop while mobile showed it whole. A chip is never hidden —
            the row wraps exactly like the quick row below it. */}
        <div
          role="tablist"
          className="flex flex-wrap justify-between gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
        >
          {STATUS_TABS.map((value) => {
            const isActive = filter === value;
            const isFollowup = value === "followup";
            const label =
              FILTER_OPTIONS.find((opt) => opt.value === value)?.label ??
              t("filterFollowupShort");
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(value)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] transition-colors",
                  isActive
                    ? isFollowup
                      ? "bg-amber-400 font-semibold text-amber-950"
                      : "bg-card font-medium text-foreground shadow-sm"
                    : isFollowup
                      ? "text-amber-400 hover:bg-muted"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                {isFollowup && <Clock className="h-3 w-3" aria-hidden />}
                {isFollowup ? t("filterFollowupShort") : label}
                {typeof filterCounts[value] === "number" && (
                  <span className="tabular-nums text-[10px] opacity-70">
                    {filterCounts[value]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Quick filters: the SAME segmented control as the status row, one
            row below it (his spec, 2026-11-05). They are attention filters —
            unread / waiting / unassigned / expiring window — not statuses,
            and they share the single `filter` state with the tabs above, so
            picking one clears the status tab. That is exactly why they must
            look like a sibling of the status row instead of a second, fancier
            kind of chip. They used to live inside the funnel popover, where
            nobody found them. */}
        <div
          role="tablist"
          aria-label={t("quickFiltersLabel")}
          className="flex flex-wrap justify-between gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
        >
          {FILTER_OPTIONS.filter((opt) => QUICK_FILTERS.includes(opt.value)).map((opt) => {
            const isActive = filter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(isActive ? DEFAULT_INBOX_FILTER : opt.value)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] transition-colors",
                  isActive
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
                {typeof filterCounts[opt.value] === "number" && (
                  <span className="tabular-nums text-[10px] opacity-70">
                    {filterCounts[opt.value]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search runs against the whole table, so the honest answer to "how
            many matched" is the server's total. */}
        {searchQuery !== "" && !loading && (
          <div className="text-muted-foreground px-1 text-[11px] tabular-nums">
            {t("resultsCount", { count: total })}
          </div>
        )}

        {/* One muted line per member view that is on, so «مين» is answerable
            without opening the funnel. */}
        {assignee && (
          <div className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
            <Users className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">
              {t("assigneeActive", { name: assignee.name ?? assignee.id })}
            </span>
            <button
              type="button"
              onClick={() => onSelectAssignee?.(null)}
              className="ms-auto shrink-0 underline-offset-2 hover:text-foreground hover:underline"
            >
              {t("participantClear")}
            </button>
          </div>
        )}

        {participant && (
          <div className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
            <Users className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">
              {t("participantActive", {
                name: participant.name ?? participant.id,
                days: participant.days,
              })}
            </span>
            <button
              type="button"
              onClick={() => onSelectParticipant?.(null)}
              className="ms-auto shrink-0 underline-offset-2 hover:text-foreground hover:underline"
            >
              {t("participantClear")}
            </button>
          </div>
        )}

        {filter === "followup" && (
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("filterFollowupExplain")}
          </p>
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
            {searchQuery !== "" && (
              <div className="mt-3 grid gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {searchScope === "all"
                    ? t("searchNoResultsWider")
                    : t("searchNoResultsMessages")}
                </p>
                <div className="flex justify-center gap-1.5">
                  {searchScope === "name" && (
                    <button
                      type="button"
                      onClick={() => setSearchScope("all")}
                      className="text-primary text-[11px] underline-offset-2 hover:underline"
                    >
                      {t("searchTryMessages")}
                    </button>
                  )}
                  {searchDays < 365 && (
                    <button
                      type="button"
                      onClick={() => setSearchDays(365)}
                      className="text-primary text-[11px] underline-offset-2 hover:underline"
                    >
                      {t("searchTryYear")}
                    </button>
                  )}
                </div>
              </div>
            )}
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
                showFollowup={filter === "followup"}
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

      {/* Floating actions — direction-driven: sliding down reveals them,
          sliding up hides them. "Load all" only while rows remain, "back to
          top" whenever the list is long enough to have been scrolled. */}
      {showFloating && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
          {hasMore && rows.length >= CONVERSATION_PAGE_SIZE * 2 && (
            <button
              type="button"
              onClick={() => void loadAll()}
              disabled={loadingAll}
              className="bg-foreground text-background whitespace-nowrap rounded-full px-4 py-2 text-[11px] font-medium shadow-lg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loadingAll
                ? t("loadingAll")
                : `${t("loadAll")} · ${total.toLocaleString("en-US")}`}
            </button>
          )}
          <button
            type="button"
            onClick={scrollToTop}
            aria-label={t("backToTop")}
            title={t("backToTop")}
            className="bg-card text-foreground ring-foreground/15 flex size-9 items-center justify-center rounded-full shadow-lg ring-1 transition-colors hover:bg-muted"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
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
  /** True while the «محتاجة متابعة» queue is showing: the row then reports
   *  how long the customer has been silent, which is what the sort uses. */
  showFollowup?: boolean;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
  numberBadge = null,
  showFollowup = false,
}: ConversationItemProps) {
  const silentDays = conversation.last_inbound_at
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(conversation.last_inbound_at).getTime()) / 86_400_000,
        ),
      )
    : 0;
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
            {showFollowup && conversation.last_inbound_at ? (
              <>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-px text-[10px] font-semibold tabular-nums",
                    silentDays >= 3
                      ? "border-red-500/40 bg-red-500/15 text-red-400"
                      : "border-amber-400/40 bg-amber-400/15 text-amber-400",
                  )}
                >
                  {t("followupSilent", { count: silentDays })}
                </span>
                {/* No «آخر رسالة مننا» tag here: every row in this queue is
                    by definition ours, and two pills per row made a 340px list
                    read as clutter. */}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
