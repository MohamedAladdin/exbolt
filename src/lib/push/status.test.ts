import { describe, expect, it } from "vitest";

import { buildPushStatus } from "./status";

const members = [
  { user_id: "u1", full_name: "منى", account_role: "agent" },
  { user_id: "u2", full_name: "أحمد", account_role: "owner" },
  { user_id: "u3", full_name: null, account_role: "agent" },
  { user_id: "u4", full_name: "سارة", account_role: "viewer" },
];

describe("buildPushStatus", () => {
  it("counts devices and keeps the newest activity per member", () => {
    const summary = buildPushStatus({
      members,
      subscriptions: [
        { user_id: "u2", endpoint: "e1", last_seen_at: "2026-11-01T10:00:00Z" },
        { user_id: "u2", endpoint: "e2", last_seen_at: "2026-11-05T09:00:00Z" },
      ],
      preferences: [],
    });

    const owner = summary.members.find((m) => m.user_id === "u2");
    expect(owner).toMatchObject({
      devices: 2,
      last_seen_at: "2026-11-05T09:00:00Z",
      reachable: true,
      push_enabled: true,
    });
  });

  it("a registered device with the master switch off is NOT reachable", () => {
    const summary = buildPushStatus({
      members,
      subscriptions: [{ user_id: "u1", endpoint: "e1", last_seen_at: "2026-11-05T09:00:00Z" }],
      preferences: [{ user_id: "u1", push_enabled: false, in_app_alerts: true }],
    });

    const agent = summary.members.find((m) => m.user_id === "u1");
    expect(agent).toMatchObject({ devices: 1, reachable: false, push_enabled: false });
  });

  it("a member with no preferences row is treated as on (the defaults)", () => {
    const summary = buildPushStatus({
      members: [members[0]],
      subscriptions: [{ user_id: "u1", endpoint: "e1", last_seen_at: null }],
      preferences: [],
    });
    expect(summary.members[0]).toMatchObject({ push_enabled: true, in_app_alerts: true });
  });

  it("puts the reachable members first and lists the ones to chase", () => {
    const summary = buildPushStatus({
      members,
      subscriptions: [{ user_id: "u3", endpoint: "e1", last_seen_at: "2026-11-05T09:00:00Z" }],
      preferences: [],
    });

    expect(summary.members[0].user_id).toBe("u3");
    expect(summary.reachable).toBe(1);
    expect(summary.total).toBe(4);
    expect(summary.missing.map((m) => m.user_id).sort()).toEqual(["u1", "u2", "u4"]);
  });

  it("never renders a missing name as the string \"null\"", () => {
    const summary = buildPushStatus({
      members: [{ user_id: "uz", full_name: null, account_role: "agent" }],
      subscriptions: [],
      preferences: [],
    });
    expect(summary.members[0].name).toBe("—");
  });

  it("handles an empty team", () => {
    const summary = buildPushStatus({ members: [], subscriptions: [], preferences: [] });
    expect(summary).toMatchObject({ reachable: 0, total: 0, missing: [] });
  });
});
