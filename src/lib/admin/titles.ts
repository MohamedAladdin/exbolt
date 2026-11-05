/**
 * The admin console's page names, in one table.
 *
 * `/admin` sat outside the product's title catalogue, so every page in the
 * console inherited the layout's single `<title>` — «ExBolt · Control» — which
 * is the same defect the tenant app was reported for on 2026-11-05 («عناوين
 * الصفحات مش مظبوطة … لكل صفحة وكل فرع»): the console is a set of pages he
 * uses daily and could not tell apart in tabs either.
 *
 * Pure and dependency-free: it returns a KEY into `lib/admin/copy.ts`, so the
 * resolver is unit-tested without React and the shell does the translating.
 */

export interface AdminTitleRule {
  /** Path pattern; `:param` matches exactly one non-empty segment. */
  pattern: string;
  /** Key in `lib/admin/copy.ts`. */
  key: string;
}

const RULES: AdminTitleRule[] = [
  { pattern: '/admin', key: 'nav.overview' },
  { pattern: '/admin/inquiries', key: 'inquiries.title' },
  { pattern: '/admin/requests', key: 'nav.requests' },
  { pattern: '/admin/landing', key: 'nav.landing' },
  { pattern: '/admin/accounts', key: 'accounts.title' },
  { pattern: '/admin/accounts/:id', key: 'accounts.detail' },
  { pattern: '/admin/billing', key: 'billing.title' },
  { pattern: '/admin/channels', key: 'nav.channels' },
  { pattern: '/admin/audit', key: 'nav.audit' },
  { pattern: '/admin/settings', key: 'nav.settings' },
];

function segments(pattern: string): string[] {
  return pattern.split('/').filter(Boolean);
}

function literalCount(pattern: string): number {
  return segments(pattern).filter((s) => !s.startsWith(':')).length;
}

/** Most specific first: `/admin/accounts/:id` must beat `/admin/accounts`. */
const ORDERED = [...RULES].sort(
  (a, b) =>
    segments(b.pattern).length - segments(a.pattern).length ||
    literalCount(b.pattern) - literalCount(a.pattern),
);

function matches(pattern: string, parts: string[]): boolean {
  const expected = segments(pattern);
  if (expected.length !== parts.length) return false;
  return expected.every((seg, i) =>
    seg.startsWith(':') ? parts[i].length > 0 : seg === parts[i],
  );
}

/** Route → copy key, or null when the path is not a console page. */
export function adminTitleKey(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const rule = ORDERED.find((r) => matches(r.pattern, parts));
  return rule ? rule.key : null;
}

/**
 * Final tab string. The console's own name carries the brand
 * («ExBolt · لوحة التحكم»), so a page name is simply put in front of it.
 */
export function composeAdminTitle(page: string, consoleName: string): string {
  const head = page.trim();
  return head ? `${head} — ${consoleName}` : consoleName;
}
