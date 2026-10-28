// ============================================================
// Shared auth for the externally-pinged cron routes.
//
// Nothing inside the app is scheduled: a system cron (on the box, or a
// pinger) calls these endpoints with a shared secret. Three routes now
// use the same rule, so it lives here instead of being copy-pasted —
// a security check that exists in three places drifts.
//
// Secret resolution: `ADMIN_CRON_SECRET` wins, `AUTOMATION_CRON_SECRET`
// is the fallback (one less env var to provision on the box). With
// neither set the route refuses everything rather than running open.
// ============================================================

import { timingSafeEqual } from 'node:crypto';

/** Where the caller may put the secret: header first, query string last. */
const HEADERS = ['x-admin-secret', 'x-cron-secret'];

function secretFromEnv(): string | null {
  const secret =
    process.env.ADMIN_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

/**
 * Constant-time comparison so a wrong secret leaks nothing about how
 * much of it was right. `timingSafeEqual` needs equal-length buffers,
 * so a length mismatch fails closed before the comparison.
 */
function matches(provided: string, secret: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True iff the request carries the cron secret configured for this host. */
export function cronAuthorized(request: Request): boolean {
  const secret = secretFromEnv();
  if (!secret) return false;

  for (const header of HEADERS) {
    const value = request.headers.get(header);
    if (value && matches(value, secret)) return true;
  }

  const fromQuery = new URL(request.url).searchParams.get('secret');
  return !!fromQuery && matches(fromQuery, secret);
}

/** `true` when a cron secret exists at all (used to explain a 503). */
export function cronConfigured(): boolean {
  return secretFromEnv() !== null;
}
