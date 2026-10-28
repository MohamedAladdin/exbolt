import { describe, expect, it } from "vitest";

import {
  actionKey,
  dayKey,
  fieldKey,
  groupByDay,
  isActivityCategory,
  isDestructive,
  previewValue,
  valueKind,
  visibleChanges,
  type ActivityEvent,
} from "./activity";

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 1,
    created_at: "2026-10-28T10:00:00.000Z",
    action: "settings.whatsapp_updated",
    category: "settings",
    source: "app",
    actor_user_id: "u1",
    actor_name: "محمد",
    actor_email: "m@example.com",
    actor_role: "owner",
    target_type: "whatsapp",
    target_id: "t1",
    target_label: "1234567890",
    changes: {},
    metadata: {},
    ...overrides,
  };
}

describe("actionKey", () => {
  it("flattens a dotted action into one catalogue key", () => {
    expect(actionKey("settings.whatsapp_updated")).toBe(
      "actions.settings_whatsapp_updated",
    );
    expect(actionKey("members.role_changed")).toBe("actions.members_role_changed");
  });

  it("survives an action with no domain prefix", () => {
    expect(actionKey("ping")).toBe("actions.ping");
  });
});

describe("fieldKey", () => {
  it("prefixes the raw column name", () => {
    expect(fieldKey("access_token")).toBe("fields.access_token");
  });
});

describe("isActivityCategory", () => {
  it("accepts the known categories and nothing else", () => {
    expect(isActivityCategory("members")).toBe(true);
    expect(isActivityCategory("inbox")).toBe(true);
    expect(isActivityCategory("nope")).toBe(false);
    expect(isActivityCategory(null)).toBe(false);
    expect(isActivityCategory(42)).toBe(false);
  });
});

describe("valueKind", () => {
  it("classifies the shapes the triggers actually write", () => {
    expect(valueKind(null)).toBe("empty");
    expect(valueKind("")).toBe("empty");
    expect(valueKind("•••")).toBe("secret");
    expect(valueKind("***")).toBe("secret");
    expect(valueKind(false)).toBe("boolean");
    expect(valueKind("admin")).toBe("role");
    expect(valueKind(["read", "write"])).toBe("list");
    expect(valueKind({ a: 1 })).toBe("json");
    expect(valueKind("3f2b8c9e-1d4a-4b6c-8e7f-9a0b1c2d3e4f")).toBe("id");
    expect(valueKind("مركز الخليج")).toBe("text");
  });

  it("treats a masked value as a secret even when it is not the exact bullet run", () => {
    expect(valueKind("••••")).toBe("secret");
  });
});

describe("previewValue", () => {
  it("shortens uuids so the row stays readable", () => {
    expect(
      previewValue("3f2b8c9e-1d4a-4b6c-8e7f-9a0b1c2d3e4f"),
    ).toBe("3f2b8c9e");
  });

  it("joins lists and truncates long text", () => {
    expect(previewValue(["a", "b"])).toBe("a, b");
    const long = "x".repeat(200);
    const out = previewValue(long, 40);
    expect(out.length).toBe(40);
    expect(out.endsWith("…")).toBe(true);
  });

  it("renders booleans and empties predictably", () => {
    expect(previewValue(true)).toBe("true");
    expect(previewValue(null)).toBe("");
    expect(previewValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("dayKey / groupByDay", () => {
  it("buckets consecutive days and keeps newest-first order", () => {
    const events = [
      event({ id: 4, created_at: new Date(2026, 9, 28, 9, 0).toISOString() }),
      event({ id: 3, created_at: new Date(2026, 9, 28, 8, 0).toISOString() }),
      event({ id: 2, created_at: new Date(2026, 9, 27, 23, 0).toISOString() }),
      event({ id: 1, created_at: new Date(2026, 9, 27, 22, 0).toISOString() }),
    ];
    const groups = groupByDay(events);
    expect(groups.map((g) => g.day)).toEqual(["2026-10-28", "2026-10-27"]);
    expect(groups[0].events.map((e) => e.id)).toEqual([4, 3]);
    expect(groups[1].events.map((e) => e.id)).toEqual([2, 1]);
  });

  it("derives the day from local time, not UTC", () => {
    const local = new Date(2026, 9, 28, 1, 30);
    expect(dayKey(local.toISOString())).toBe("2026-10-28");
  });

  it("survives an empty page", () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe("visibleChanges", () => {
  it("keeps the first N entries and reports the rest", () => {
    const { entries, hidden } = visibleChanges(
      {
        a: { from: 1, to: 2 },
        b: { from: 1, to: 2 },
        c: { from: 1, to: 2 },
        d: { from: 1, to: 2 },
      },
      3,
    );
    expect(entries.map(([key]) => key)).toEqual(["a", "b", "c"]);
    expect(hidden).toBe(1);
  });

  it("handles a missing diff (created/deleted rows have none)", () => {
    expect(visibleChanges(null)).toEqual({ entries: [], hidden: 0 });
    expect(visibleChanges({})).toEqual({ entries: [], hidden: 0 });
  });
});

describe("isDestructive", () => {
  it("flags removals so the UI can colour them", () => {
    expect(isDestructive("members.removed")).toBe(true);
    expect(isDestructive("integrations.api_key_deleted")).toBe(true);
    expect(isDestructive("settings.whatsapp_disconnected")).toBe(true);
    expect(isDestructive("automations.flow_updated")).toBe(false);
  });
});
