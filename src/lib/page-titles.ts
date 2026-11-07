/**
 * Every page's name, in ONE catalogue.
 *
 * Why this file exists: the tab title and the shell header each kept their own
 * partial map. The header's map had no `/flows` or `/agents`, so both screens
 * announced «لوحة التحكم», and the tab title was rewritten by Next's own
 * metadata on every navigation, so it stayed «ExBolt» everywhere. Reported
 * 2026-11-05: «عناوين الصفحات مش مظبوطة … عايز عناوين صح لكل صفحة وكل فرع،
 * وكمان مش بيحط اسم المحادثة لما أفتح واحدة».
 *
 * Pure and dependency-free on purpose (no next-intl, no React): the resolver
 * is unit-tested without a DOM, and the two consumers — the shell header and
 * the document-title writer — read the same table, so they cannot drift.
 *
 * Composition rule: an object's own name (a conversation's contact, a flow, a
 * broadcast) leads, then the most specific static label, then the brand:
 *   «منى عبد الله — صندوق الوارد — ExBolt»
 *   «حملة رمضان — الحملات — ExBolt»
 *   «واتساب — الإعدادات — ExBolt»
 * The parent label is dropped when a name is present: a tab has room for three
 * segments, and the name plus the section already locate the page.
 */

export type TitleNamespace = "Sidebar" | "PageTitles" | "Settings";

export interface TitleLabel {
  ns: TitleNamespace;
  /** Message key inside `ns`; `Settings` uses the dotted `sections.<tab>` path. */
  key: string;
}

export interface PageTitle {
  /** Most specific first. */
  labels: TitleLabel[];
  /** True when the page supplies the leading segment (an object's own name). */
  named: boolean;
}

interface RouteTitle extends PageTitle {
  /** Path pattern; `:param` matches exactly one non-empty segment. */
  pattern: string;
}

/**
 * Settings sections, duplicated here to keep this module free of the
 * settings rail's icon imports. `page-titles.test.ts` fails if the two lists
 * disagree, so a new section cannot be added without a tab title.
 */
export const SETTINGS_TABS = [
  "overview",
  "profile",
  "security",
  "appearance",
  "notifications",
  "whatsapp",
  "channels",
  "branding",
  "plan",
  "billing",
  "templates",
  "quick-replies",
  "inbox",
  "fields",
  "deals",
  "members",
  "activity",
  "api",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

const SIDEBAR = (key: string): TitleLabel => ({ ns: "Sidebar", key });
const PAGE = (key: string): TitleLabel => ({ ns: "PageTitles", key });

/**
 * Ordered by specificity at module load (longest pattern first, then most
 * literal segments), so `/flows/:id/runs` is never shadowed by `/flows/:id`
 * and `/broadcasts/new` is never read as a broadcast id.
 */
const ROUTES: RouteTitle[] = [
  { pattern: "/inbox", labels: [SIDEBAR("inbox")], named: true },
  { pattern: "/notifications", labels: [SIDEBAR("notifications")], named: false },
  { pattern: "/contacts", labels: [SIDEBAR("contacts")], named: false },
  { pattern: "/pipelines", labels: [SIDEBAR("pipelines")], named: false },

  { pattern: "/broadcasts", labels: [SIDEBAR("broadcasts")], named: false },
  {
    pattern: "/broadcasts/new",
    labels: [PAGE("newBroadcast"), SIDEBAR("broadcasts")],
    named: false,
  },
  { pattern: "/broadcasts/:id", labels: [SIDEBAR("broadcasts")], named: true },

  { pattern: "/automations", labels: [SIDEBAR("automations")], named: false },
  {
    pattern: "/automations/new",
    labels: [PAGE("newAutomation"), SIDEBAR("automations")],
    named: false,
  },
  {
    pattern: "/automations/:id/edit",
    labels: [PAGE("editAutomation"), SIDEBAR("automations")],
    named: true,
  },
  {
    pattern: "/automations/:id/logs",
    labels: [PAGE("automationLogs"), SIDEBAR("automations")],
    named: true,
  },

  { pattern: "/flows", labels: [SIDEBAR("flows")], named: false },
  {
    pattern: "/flows/:id/runs",
    labels: [PAGE("flowRuns"), SIDEBAR("flows")],
    named: true,
  },
  { pattern: "/flows/:id", labels: [SIDEBAR("flows")], named: true },

  { pattern: "/agents", labels: [SIDEBAR("aiAgents")], named: false },
  { pattern: "/reports", labels: [SIDEBAR("reports")], named: false },
  { pattern: "/settings", labels: [SIDEBAR("settings")], named: false },
  { pattern: "/team/:id", labels: [PAGE("teamMember")], named: true },
  { pattern: "/dashboard", labels: [SIDEBAR("dashboard")], named: false },
].sort(
  (a, b) =>
    segments(b.pattern).length - segments(a.pattern).length ||
    literalCount(b.pattern) - literalCount(a.pattern),
);

function segments(pattern: string): string[] {
  return pattern.split("/").filter(Boolean);
}

function literalCount(pattern: string): number {
  return segments(pattern).filter((s) => !s.startsWith(":")).length;
}

function matches(pattern: string, parts: string[]): boolean {
  const expected = segments(pattern);
  if (expected.length !== parts.length) return false;
  return expected.every((seg, i) =>
    seg.startsWith(":") ? parts[i].length > 0 : seg === parts[i],
  );
}

/** A tab value from the URL, or null when it is absent/unknown. */
export function normalizeSettingsTab(
  tab: string | null | undefined,
): SettingsTab | null {
  const value = tab?.trim();
  if (!value) return null;
  return (SETTINGS_TABS as readonly string[]).includes(value)
    ? (value as SettingsTab)
    : null;
}

/**
 * Route → what the page is called. `tab` only matters on `/settings`, whose
 * sections are a real URL branch (`?tab=`); every other page's branches are
 * path segments and are matched from `pathname` alone.
 */
export function resolvePageTitle(
  pathname: string,
  tab?: string | null,
): PageTitle | null {
  const parts = pathname.split("/").filter(Boolean);
  const route = ROUTES.find((r) => matches(r.pattern, parts));
  if (!route) return null;

  if (route.pattern === "/settings") {
    const section = normalizeSettingsTab(tab);
    if (!section || section === "overview") {
      return { labels: route.labels, named: false };
    }
    return {
      labels: [{ ns: "Settings", key: `sections.${section}` }, ...route.labels],
      named: false,
    };
  }

  return { labels: route.labels, named: route.named };
}

/**
 * Final tab string. Missing/blank name falls back to the static labels only —
 * never a placeholder word, which is what made every tab read «ExBolt».
 */
export function composeDocumentTitle(
  name: string | null | undefined,
  labels: string[],
  brand: string,
): string {
  const head = name?.trim();
  const parts = head ? [head, ...labels.slice(0, 1)] : labels;
  return [...parts.filter(Boolean), brand].join(" — ");
}

/**
 * A tab title is a single line, and the browser normalises whitespace when
 * it stores one. An object name may not be single-line (a WhatsApp contact
 * can be named "…\n/\n-"), so composing it verbatim produces a string that
 * `document.title` can never equal after assignment — the writer's
 * `document.title !== title` guard is then always true, its MutationObserver
 * sees its own write, and the tab spins in a synchronous mutation loop until
 * it freezes. Collapse whitespace before writing.
 */
export function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/** Does the live `document.title` already say what we want (per whitespace)? */
export function titleMatches(current: string, desired: string): boolean {
  return normalizeTitle(current) === normalizeTitle(desired);
}
