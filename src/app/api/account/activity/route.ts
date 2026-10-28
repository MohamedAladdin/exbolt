// ============================================================
// /api/account/activity
//
//   GET — the account's audit trail, newest first.
//
// Who may read it: admin+ only. The rows name colleagues and show
// what they changed, so an agent or viewer reading it would turn an
// accountability tool into an internal-surveillance feed. The same
// rule is enforced twice — `requireRole('admin')` here and the
// `account_activity_read_admin` RLS policy (migration 070), so a
// route that forgot the guard still cannot leak rows.
//
// Writes are impossible from here: the table has no insert/update/
// delete policy at all, and rows are produced only by the triggers
// that watch the audited tables.
//
// Pagination is keyset (`before=<id>`), not offset: the log is
// append-only and busy, and `OFFSET` on a table that grows under
// your feet silently skips rows.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isActivityCategory } from "@/lib/audit/activity";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/translate";

const t = getT("Api");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Characters that would break PostgREST's `or=(…)` filter grammar. */
const SEARCH_STRIP = /[,()*%\\"]/g;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `activity:read:${ctx.userId}`,
      RATE_LIMITS.auditRead,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const url = new URL(request.url);
    const params = url.searchParams;

    const rawLimit = Number(params.get("limit") ?? DEFAULT_LIMIT);
    const pageSize =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;

    const category = params.get("category");
    const actor = params.get("actor");
    const before = Number(params.get("before") ?? 0);
    const search = (params.get("q") ?? "").replace(SEARCH_STRIP, "").trim();

    let query = ctx.supabase
      .from("account_activity_log")
      .select(
        "id, created_at, action, category, source, actor_user_id, actor_name, actor_email, actor_role, target_type, target_id, target_label, changes, metadata",
      )
      .eq("account_id", ctx.accountId)
      .order("id", { ascending: false })
      .limit(pageSize + 1); // +1 row tells us whether there is another page

    if (category && isActivityCategory(category)) {
      query = query.eq("category", category);
    }
    if (actor && UUID_RE.test(actor)) {
      query = query.eq("actor_user_id", actor);
    }
    if (Number.isFinite(before) && before > 0) {
      query = query.lt("id", before);
    }
    if (search) {
      const term = search.slice(0, 80);
      query = query.or(
        `target_label.ilike.%${term}%,actor_name.ilike.%${term}%,action.ilike.%${term}%`,
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error("[activity] read failed:", error.message);
      return NextResponse.json(
        { error: t("activity.readFailed") },
        { status: 500 },
      );
    }

    const rows = data ?? [];
    const events = rows.slice(0, pageSize);
    const nextCursor =
      rows.length > pageSize && events.length > 0
        ? events[events.length - 1].id
        : null;

    // Actor list feeds the "who" filter. Only needed on the first
    // page — a filter change refetches page 1 anyway.
    let actors: {
      id: string | null;
      name: string | null;
      email: string | null;
      events: number;
    }[] = [];

    if (!before) {
      const { data: actorRows, error: actorError } = await ctx.supabase
        .from("account_activity_actors")
        .select("actor_user_id, actor_name, actor_email, events, last_seen")
        .eq("account_id", ctx.accountId)
        .order("last_seen", { ascending: false })
        .limit(50);

      if (actorError) {
        // Non-fatal: the timeline still works without the filter.
        console.error("[activity] actors read failed:", actorError.message);
      } else {
        actors = (actorRows ?? []).map((row) => ({
          id: row.actor_user_id,
          name: row.actor_name,
          email: row.actor_email,
          events: Number(row.events ?? 0),
        }));
      }
    }

    return NextResponse.json({
      events,
      nextCursor,
      actors,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
