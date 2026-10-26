"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";

import { useAuth } from "@/hooks/use-auth";
import { composeBrandTitle } from "@/lib/branding";

/**
 * Keeps `document.title` in sync with the account's white-label name.
 *
 * The static metadata in `app/layout.tsx` cannot know the account (it is
 * rendered per request, before the client resolves the profile) and the
 * app is `noindex`, so the title is set here instead of buying a DB query
 * on every server render. Runs on brand or locale change, and no-ops when
 * the account is unbranded — the server-rendered title stands.
 */
export function BrandTitle() {
  const { account } = useAuth();
  const locale = useLocale();

  useEffect(() => {
    const brand = account?.brand_name ?? null;
    if (!brand) return;
    document.title = composeBrandTitle(brand, locale);
  }, [account?.brand_name, locale]);

  return null;
}
