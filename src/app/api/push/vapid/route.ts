// ============================================================
// /api/push/vapid — the application server key the browser needs to
// create a subscription.
//
// Why a route instead of `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: `NEXT_PUBLIC_*`
// is baked into the bundle at build time, so rotating keys (or adding
// them for the first time) would need a rebuild of the app image before
// any browser could subscribe. Reading it at request time keeps the key
// a deployment concern, not a build concern.
//
// Session-gated: the key is not a secret, but a signed-in caller is the
// only one who could do anything with it.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { isPushConfigured, vapidPublicKey } from "@/lib/push/web-push";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const publicKey = vapidPublicKey();
  if (!publicKey || !isPushConfigured()) {
    // 503, not 500: the product is fine, this deployment has not been given keys.
    return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
  }

  return NextResponse.json({ publicKey });
}
