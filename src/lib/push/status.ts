/**
 * Who on this team actually receives alerts?
 *
 * A notification channel nobody enabled is a feature that looks finished and
 * silently does nothing — so the tenant's admin has to be able to see the roster:
 * who has a device registered, who never enabled one, and who switched push off
 * after enabling it.
 *
 * Pure aggregation over three queries (`profiles`, `push_subscriptions`,
 * `notification_preferences`) so the counting rules are testable without a database.
 */

export type MemberRole = "owner" | "admin" | "agent" | "viewer" | string;

export interface StatusMemberRow {
  user_id: string;
  full_name: string | null;
  account_role: MemberRole;
}

export interface StatusSubscriptionRow {
  user_id: string;
  endpoint: string;
  last_seen_at: string | null;
  failures?: number | null;
}

export interface StatusPreferenceRow {
  user_id: string;
  push_enabled: boolean | null;
  in_app_alerts: boolean | null;
}

export interface MemberPushStatus {
  user_id: string;
  name: string;
  role: MemberRole;
  /** Registered devices (0 = cannot receive anything out-of-app). */
  devices: number;
  /** Newest device activity, ISO or null. */
  last_seen_at: string | null;
  /** The per-user push master switch. */
  push_enabled: boolean;
  /** The per-user in-app master switch. */
  in_app_alerts: boolean;
  /** True when at least one device is registered AND the master switch is on. */
  reachable: boolean;
}

export interface PushStatusSummary {
  members: MemberPushStatus[];
  /** Members reachable out-of-app. */
  reachable: number;
  total: number;
  /** Agents/admins with no device — the ones an admin should chase. */
  missing: MemberPushStatus[];
}

function newest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function buildPushStatus(args: {
  members: StatusMemberRow[];
  subscriptions: StatusSubscriptionRow[];
  preferences: StatusPreferenceRow[];
}): PushStatusSummary {
  const devicesByUser = new Map<string, { count: number; lastSeen: string | null }>();
  for (const sub of args.subscriptions) {
    const current = devicesByUser.get(sub.user_id) ?? { count: 0, lastSeen: null };
    devicesByUser.set(sub.user_id, {
      count: current.count + 1,
      lastSeen: newest(current.lastSeen, sub.last_seen_at),
    });
  }

  const prefsByUser = new Map(args.preferences.map((p) => [p.user_id, p]));

  const members: MemberPushStatus[] = args.members.map((member) => {
    const device = devicesByUser.get(member.user_id) ?? { count: 0, lastSeen: null };
    const prefs = prefsByUser.get(member.user_id);
    // A user with no preferences row has the defaults, which are on.
    const pushEnabled = prefs?.push_enabled ?? true;
    const inApp = prefs?.in_app_alerts ?? true;

    return {
      user_id: member.user_id,
      name: member.full_name?.trim() || "—",
      role: member.account_role,
      devices: device.count,
      last_seen_at: device.lastSeen,
      push_enabled: pushEnabled,
      in_app_alerts: inApp,
      reachable: pushEnabled && device.count > 0,
    };
  });

  // Reachable first, then whoever has been silent longest: the admin is scanning for
  // the people to chase, not for an alphabetical list.
  members.sort((a, b) => {
    if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
    if (a.devices !== b.devices) return b.devices - a.devices;
    return a.name.localeCompare(b.name);
  });

  return {
    members,
    reachable: members.filter((m) => m.reachable).length,
    total: members.length,
    missing: members.filter((m) => !m.reachable),
  };
}
