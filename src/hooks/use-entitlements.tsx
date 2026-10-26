"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { Entitlements, Feature, LimitKey } from "@/lib/plans/entitlements";

/**
 * Client-side view of the account's plan.
 *
 * Fetched once per session and shared through context: the sidebar, the
 * settings plan panel and any `FeatureGate` all read the same object, so a
 * page does not fire five entitlement requests.
 *
 * This is presentation state. It decides what to *show*; the API routes
 * re-check with `requireFeature` before doing the work.
 */
interface EntitlementsState {
  entitlements: Entitlements | null;
  loading: boolean;
  error: string | null;
  /** Server-truth refresh after a plan change (super-admin, billing webhook). */
  refresh: () => void;
}

const EntitlementsContext = createContext<EntitlementsState>({
  entitlements: null,
  loading: true,
  error: null,
  refresh: () => {},
});

interface WireEntitlements {
  plan: Entitlements["plan"];
  status: Entitlements["status"];
  billing_interval: Entitlements["billing_interval"];
  current_period_end: string | null;
  trial_ends_at: string | null;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  entitled: boolean;
  is_default: boolean;
}

function hydrate(wire: WireEntitlements): Entitlements {
  return {
    plan: wire.plan,
    status: wire.status,
    billing_interval: wire.billing_interval,
    current_period_end: wire.current_period_end,
    trial_ends_at: wire.trial_ends_at,
    features: wire.features as Entitlements["features"],
    limits: wire.limits as Entitlements["limits"],
    entitled: wire.entitled,
    isDefault: wire.is_default,
  };
}

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/account/entitlements", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as
          | WireEntitlements
          | { error?: string };
        if (cancelled) return;
        if (res.ok && "plan" in data) {
          setEntitlements(hydrate(data));
          setError(null);
        } else {
          setError(("error" in data && data.error) || "Failed to load plan");
        }
      } catch {
        if (!cancelled) setError("Failed to load plan");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return (
    <EntitlementsContext.Provider
      value={{
        entitlements,
        loading,
        error,
        refresh: () => setNonce((n) => n + 1),
      }}
    >
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements(): EntitlementsState {
  return useContext(EntitlementsContext);
}

/**
 * Is one capability available on this plan?
 *
 * Returns `false` while loading — the same "never flash a permission you
 * do not have" rule as `useCan`.
 */
export function useFeature(feature: Feature): boolean {
  const { entitlements } = useContext(EntitlementsContext);
  if (!entitlements) return false;
  if (!entitlements.entitled) return false;
  return entitlements.features[feature] !== false;
}

/** Room left before a limit is hit (`null` limit = unlimited). */
export function useLimit(key: LimitKey): number | null | undefined {
  const { entitlements } = useContext(EntitlementsContext);
  if (!entitlements) return undefined;
  return entitlements.limits[key];
}
