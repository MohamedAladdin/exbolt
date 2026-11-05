"use client";

/**
 * The browser tab is a surface the product forgot.
 *
 * Every page used to be titled «ExBolt», so five open tabs were five copies of
 * the same word and the inbox — the screen people live in all day — could not
 * be told apart from the settings page. Reported 2026-11-05: «المطلوب تغيير
 * وتعيين الـtitles يكون زي الصفحة المفتوحة أو الدردشة المفتوحة».
 *
 * Two hooks, one source of truth:
 *   * `usePageTitle()` — the route → its name from the Sidebar catalogue;
 *   * `useConversationTitle(name)` — the open thread wins over the route, and
 *     closing it restores the page title.
 *
 * `— ExBolt` is appended by hand rather than relying on the metadata template,
 * because the title is rewritten after hydration and the template only applies
 * to server-rendered metadata.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const BRAND = "ExBolt";

/** Longest prefix wins, so `/inbox/…` resolves to `inbox` before `/`. */
const ROUTES: [string, string][] = [
  ["/inbox", "inbox"],
  ["/notifications", "notifications"],
  ["/contacts", "contacts"],
  ["/pipelines", "pipelines"],
  ["/broadcasts", "broadcasts"],
  ["/automations", "automations"],
  ["/flows", "flows"],
  ["/agents", "aiAgents"],
  ["/reports", "reports"],
  ["/settings", "settings"],
  ["/team", "settings"],
  ["/dashboard", "dashboard"],
];

/** Pure route → Sidebar message key. Exported so it is testable without a DOM. */
export function routeTitleKey(pathname: string): string | null {
  const match = ROUTES.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? match[1] : null;
}

export function usePageTitle(): void {
  const pathname = usePathname();
  const t = useTranslations("Sidebar");

  useEffect(() => {
    const key = routeTitleKey(pathname);
    if (!key) {
      document.title = BRAND;
      return;
    }
    const label = t(key as never);
    document.title = label && label !== key ? `${label} — ${BRAND}` : BRAND;
  }, [pathname, t]);
}

/** The open thread's contact name takes over the tab; null restores the page. */
export function useConversationTitle(contactName: string | null | undefined): void {
  const t = useTranslations("Sidebar");

  useEffect(() => {
    const base = t("inbox");
    document.title = contactName?.trim()
      ? `${contactName.trim()} — ${base} — ${BRAND}`
      : `${base} — ${BRAND}`;
  }, [contactName, t]);
}
