import { describe, expect, it } from "vitest";

import {
  POPUP_TYPES,
  SEEN_MAX,
  isPopupType,
  popupBody,
  popupHref,
  rememberOnce,
  typeLabelKey,
} from "./popup";

describe("isPopupType", () => {
  it("accepts exactly the types the notifications table can hold", () => {
    for (const type of POPUP_TYPES) expect(isPopupType(type)).toBe(true);
  });

  it("rejects anything else, so a new DB type cannot render a raw keypath", () => {
    expect(isPopupType("conversation_archived")).toBe(false);
    expect(isPopupType("")).toBe(false);
  });

  it("maps a known type to its label key and an unknown one to null", () => {
    expect(typeLabelKey("report_alert")).toBe("report_alert");
    expect(typeLabelKey("nope")).toBeNull();
  });
});

describe("popupBody", () => {
  it("keeps the stored text — it carries the agent name and the customer's words", () => {
    expect(
      popupBody("Ali assigned you a conversation with Ahmed"),
    ).toBe("Ali assigned you a conversation with Ahmed");
  });

  it("drops the boilerplate handoff hint, which the popup's own action replaces", () => {
    expect(
      popupBody(
        '🤖 AI agent handed off after 3 replies. Last customer message: “فرع المهندسين” Pick it up in the inbox.',
      ),
    ).toBe(
      '🤖 AI agent handed off after 3 replies. Last customer message: “فرع المهندسين”',
    );
  });

  it("handles a hint with no leading space and a body that is only the hint", () => {
    expect(popupBody("Something happened.Pick it up in the inbox.")).toBe(
      "Something happened.",
    );
    expect(popupBody("Pick it up in the inbox.")).toBe("");
  });

  it("never renders null/undefined as the string \"null\"", () => {
    expect(popupBody(null)).toBe("");
    expect(popupBody(undefined)).toBe("");
    expect(popupBody("   ")).toBe("");
  });
});

describe("popupHref", () => {
  it("deep-links the conversation when the row has one", () => {
    expect(popupHref({ conversation_id: "c-1" })).toBe("/inbox?c=c-1");
  });

  it("escapes the id instead of pasting it into the query", () => {
    expect(popupHref({ conversation_id: "a b&c" })).toBe("/inbox?c=a%20b%26c");
  });

  it("falls back to the notifications list for a row with no conversation", () => {
    expect(popupHref({ conversation_id: undefined })).toBe("/notifications");
  });
});


describe("rememberOnce", () => {
  it("lets an id through once and swallows the realtime replay", () => {
    const seen = new Set<string>();
    expect(rememberOnce(seen, "n1")).toBe(true);
    expect(rememberOnce(seen, "n1")).toBe(false);
    expect(rememberOnce(seen, "n2")).toBe(true);
  });

  it("caps the set so a tab left open for weeks cannot grow forever", () => {
    const seen = new Set<string>();
    for (let i = 0; i < SEEN_MAX + 10; i += 1) rememberOnce(seen, `n${i}`);
    expect(seen.size).toBe(SEEN_MAX);
    // Oldest entries were dropped, newest kept.
    expect(seen.has("n0")).toBe(false);
    expect(seen.has(`n${SEEN_MAX + 9}`)).toBe(true);
  });
});
