"use client";

import type { ReactNode } from "react";

import { useFeature } from "@/hooks/use-entitlements";
import type { Feature } from "@/lib/plans/entitlements";

/**
 * Render children only when the account's plan includes `feature`.
 *
 * Presentation only — it keeps links, buttons and panels a plan does not
 * cover out of the UI so a user is never invited to click something the API
 * will refuse with 402. The server re-checks with `requireFeature`.
 */
export function FeatureGate({
  feature,
  children,
  fallback = null,
}: {
  feature: Feature;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = useFeature(feature);
  return <>{allowed ? children : fallback}</>;
}
