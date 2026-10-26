import { describe, expect, it } from "vitest";

import {
  filterQuickReplies,
  normalizeForSearch,
  slashQueryAt,
} from "./quick-reply-search";
import type { QuickReply } from "@/types";

function qr(id: string, title: string, body = "", kind: "text" | "interactive" = "text"): QuickReply {
  return {
    id,
    account_id: "acc",
    user_id: "user",
    title,
    kind,
    content_text: body,
    interactive_payload: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as unknown as QuickReply;
}

describe("slashQueryAt", () => {
  it("detects a slash at the start of the composer", () => {
    expect(slashQueryAt("/", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("captures the query after the slash", () => {
    expect(slashQueryAt("/اهلا", 5)).toEqual({ start: 0, end: 5, query: "اهلا" });
  });

  it("works after existing text", () => {
    expect(slashQueryAt("hello /welcome", 14)).toEqual({
      start: 6,
      end: 14,
      query: "welcome",
    });
  });

  it("does not trigger inside a URL", () => {
    expect(slashQueryAt("https://", 8)).toBeNull();
  });

  it("stops matching once whitespace follows the query", () => {
    expect(slashQueryAt("/اهلا بك", 8)).toBeNull();
  });
});

describe("normalizeForSearch", () => {
  it("folds Arabic letter variants and strips diacritics", () => {
    expect(normalizeForSearch("أَهْلاً")).toBe(normalizeForSearch("اهلا"));
    expect(normalizeForSearch("مصطفى")).toBe(normalizeForSearch("مصطفي"));
  });

  it("lowercases Latin text", () => {
    expect(normalizeForSearch("Welcome")).toBe("welcome");
  });
});

describe("filterQuickReplies", () => {
  const items = [
    qr("1", "أهلاً بك", "أهلاً بك في خدمة العملاء"),
    qr("2", "مواعيد العمل", "نعمل من 9 صباحًا حتى 5 مساءً، أهلًا بك"),
    qr("3", "Shipping", "Orders ship within 24 hours"),
    qr("4", "اعادة", "يمكنك إعادة الطلب"),
  ];

  it("returns everything for an empty query", () => {
    expect(filterQuickReplies(items, "")).toHaveLength(4);
  });

  it("matches an Arabic query with different alef forms", () => {
    const result = filterQuickReplies(items, "اهلا");
    // "أهلاً بك" (title prefix) ranks above the body match.
    expect(result.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("matches the body as well as the title", () => {
    const result = filterQuickReplies(items, "9 صباحا");
    expect(result.map((r) => r.id)).toEqual(["2"]);
  });

  it("is case-insensitive for Latin queries", () => {
    expect(filterQuickReplies(items, "SHIP").map((r) => r.id)).toEqual(["3"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterQuickReplies(items, "zzzz")).toEqual([]);
  });
});
