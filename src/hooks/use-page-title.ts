"use client";

/**
 * Label lookups shared by the two title surfaces.
 *
 * The tab title (`components/layout/document-title.tsx`) and the shell header
 * (`components/layout/header.tsx`) both read the catalogue in
 * `lib/page-titles.ts`; this hook is the only place that turns a catalogue
 * entry into a translated string, so the header and the tab cannot name the
 * same page differently — which is how `/flows` and `/agents` ended up titled
 * «لوحة التحكم» in the header while every tab said «ExBolt».
 */

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { resolvePageTitle, type TitleLabel } from "@/lib/page-titles";

export function useTitleTranslator(): (label: TitleLabel) => string | null {
  const tSidebar = useTranslations("Sidebar");
  const tPages = useTranslations("PageTitles");
  const tSettings = useTranslations("Settings");

  return useCallback(
    (label: TitleLabel): string | null => {
      const raw =
        label.ns === "Sidebar"
          ? tSidebar(label.key as never)
          : label.ns === "Settings"
            ? tSettings(label.key)
            : tPages(label.key as never);
      // next-intl echoes the key path for a missing message; a heading that
      // reads «PageTitles.flowRuns» is worse than falling back to the parent.
      return typeof raw === "string" && raw && raw !== label.key ? raw : null;
    },
    [tSidebar, tPages, tSettings],
  );
}

/**
 * The visible page name for the shell header — the most specific static label
 * of the current route (never an object's name, which belongs to the tab).
 * `null` for a route the catalogue does not know; the header falls back then.
 */
export function usePageHeading(): string | null {
  const pathname = usePathname();
  const translate = useTitleTranslator();
  const page = resolvePageTitle(pathname);
  if (!page) return null;
  return translate(page.labels[0]);
}
