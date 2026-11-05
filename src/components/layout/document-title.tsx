"use client";

/**
 * The single writer of `document.title`.
 *
 * Two things made the tab title useless before this component:
 *
 *   1. **Next owns `<title>`.** App Router renders the metadata title as a
 *      React element in `<head>`, so every navigation (and the RSC update that
 *      follows a `router.replace`) replaces that element and stamps the root
 *      default back over whatever a `useEffect` had written. Measured on the
 *      local build: a MutationObserver caught «مسارات البيع — ExBolt» land,
 *      then the head's title element was swapped for «ExBolt» milliseconds
 *      later — which is exactly the «ثابتة على ExBolt» report. So the writer
 *      keeps a MutationObserver on `<head>` and re-asserts the title whenever
 *      something else overwrites it (guarded by a string compare, so it
 *      settles instead of looping).
 *   2. **Two competing writers.** The route title lived in the shell (a parent
 *      effect) and the conversation title in the inbox page (a child effect);
 *      children's effects run first, so the parent's route title overwrote the
 *      open thread. Now there is one state: a name override plus the route,
 *      composed once.
 *
 * Pages that carry an object's own name call `useTitleName(...)`.
 */

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { useAuth } from "@/hooks/use-auth";
import { useTitleTranslator } from "@/hooks/use-page-title";
import { PRODUCT_NAME, brandName } from "@/lib/branding";
import {
  composeDocumentTitle,
  resolvePageTitle,
} from "@/lib/page-titles";

interface TitleState {
  /** The open object's name (conversation contact, flow, campaign …). */
  name: string | null;
  setName: (next: string | null) => void;
}

const TitleContext = createContext<TitleState | null>(null);

export function DocumentTitleProvider({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const set = useCallback((next: string | null) => setName(next), []);
  const value = useMemo(() => ({ name, setName: set }), [name, set]);

  return (
    <TitleContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <DocumentTitle />
      </Suspense>
    </TitleContext.Provider>
  );
}

/**
 * Declare the open object's name for the tab. Blank/null clears it, and
 * unmounting clears it — so leaving a thread restores «صندوق الوارد».
 */
export function useTitleName(name: string | null | undefined): void {
  const setName = useContext(TitleContext)?.setName;
  const value = (name ?? "").trim() || null;

  useEffect(() => {
    if (!setName) return;
    setName(value);
    return () => setName(null);
  }, [setName, value]);
}

function DocumentTitle() {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const state = useContext(TitleContext);
  const translate = useTitleTranslator();
  const { account } = useAuth();

  const name = state?.name ?? null;
  const brand = account?.brand_name?.trim()
    ? brandName(account.brand_name)
    : PRODUCT_NAME;

  const title = useMemo(() => {
    const page = resolvePageTitle(pathname, tab);
    if (!page) return brand;

    const labels = page.labels
      .map(translate)
      .filter((label): label is string => label !== null);
    if (labels.length === 0) return brand;

    return composeDocumentTitle(page.named ? name : null, labels, brand);
  }, [pathname, tab, name, brand, translate]);

  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();

    // Next re-renders `<head>`'s title element on every navigation, which
    // resets `document.title`; put ours back. The compare in `apply` is the
    // loop guard — writing the same string fires no further mutation.
    const head = document.head;
    if (!head) return;
    const observer = new MutationObserver(apply);
    observer.observe(head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);

  return null;
}

/**
 * The writer itself, for surfaces outside the dashboard shell (the admin
 * console has its own layout and its own name table).
 *
 * Every symptom this fixes — an empty tab, a tab that snaps back to the
 * brand — comes from the same two causes documented above, so the logic is
 * shared rather than copied: one place writes `document.title`, and it keeps
 * re-asserting it while Next reconciles `<head>`.
 */
export function useDocumentTitleText(title: string): void {
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();

    const head = document.head;
    if (!head) return;
    const observer = new MutationObserver(apply);
    observer.observe(head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
