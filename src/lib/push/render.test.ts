import { describe, expect, it } from "vitest";

import type { PushLocale } from "./payload";
import { isQuietNow, renderPush } from "./render";

const LOCALES: PushLocale[] = ["ar", "en"];

describe("renderPush", () => {
  it("has copy for every kind in both locales (no untranslated kind ships)", () => {
    for (const locale of LOCALES) {
      for (const kind of [
        "customer_message",
        "conversation_assigned",
        "ai_handoff",
        "report_alert",
      ] as const) {
        const content = renderPush(
          { kind, contactName: "أحمد", preview: "عايز سعر", url: "/inbox?c=1", tag: "t" },
          locale,
        );
        expect(content.title.trim().length).toBeGreaterThan(0);
        expect(content.body.trim().length).toBeGreaterThan(0);
        expect(content.body).not.toContain("{name}");
      }
    }
  });

  it("privacy=none never leaks the name or the message", () => {
    const content = renderPush(
      {
        kind: "customer_message",
        contactName: "ياسمين أسامة",
        preview: "عايزة أعرف سعر الكشف",
        url: "/inbox?c=1",
        tag: "conv:1",
      },
      "ar",
      "none",
    );

    expect(content.title).not.toContain("ياسمين");
    expect(content.body).not.toContain("ياسمين");
    expect(content.body).not.toContain("سعر الكشف");
  });

  it("privacy=name shows the sender but not what they wrote", () => {
    const content = renderPush(
      {
        kind: "customer_message",
        contactName: "ياسمين أسامة",
        preview: "عايزة أعرف سعر الكشف",
        url: "/inbox?c=1",
        tag: "conv:1",
      },
      "ar",
      "name",
    );

    expect(content.title).toBe("ياسمين أسامة");
    expect(content.body).not.toContain("سعر الكشف");
  });

  it("privacy=full shows the newest message", () => {
    const content = renderPush(
      {
        kind: "customer_message",
        contactName: "أحمد",
        preview: "الطلب وصل امتى؟",
        url: "/inbox?c=1",
        tag: "conv:1",
      },
      "ar",
      "full",
    );

    expect(content.body).toContain("الطلب");
  });

  it("clamps a long message instead of sending an oversized body", () => {
    const content = renderPush(
      {
        kind: "customer_message",
        contactName: "أحمد",
        preview: "كلمة ".repeat(200),
        url: "/inbox?c=1",
        tag: "conv:1",
      },
      "ar",
      "full",
    );

    expect(content.body.length).toBeLessThanOrEqual(111);
  });

  it("falls back to a generic sender when the contact has no name", () => {
    const content = renderPush(
      { kind: "customer_message", contactName: null, preview: null, url: null, tag: "x" },
      "ar",
      "name",
    );

    expect(content.title).toBe("عميل");
  });

  it("carries the tag and url the service worker needs", () => {
    const content = renderPush(
      { kind: "ai_handoff", contactName: "أحمد", preview: null, url: "/inbox?c=9", tag: "conv:9" },
      "en",
    );

    expect(content.tag).toBe("conv:9");
    expect(content.url).toBe("/inbox?c=9");
    expect(content.kind).toBe("ai_handoff");
  });
});

describe("isQuietNow", () => {
  const at = (iso: string) => new Date(iso);

  it("is off when either end is missing", () => {
    expect(isQuietNow(null, "07:00", "Africa/Cairo", at("2026-11-05T23:00:00Z"))).toBe(false);
    expect(isQuietNow("22:00", null, "Africa/Cairo", at("2026-11-05T23:00:00Z"))).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    // 23:00 Cairo = 21:00Z (UTC+2)
    expect(isQuietNow("22:00", "07:00", "Africa/Cairo", at("2026-11-05T21:00:00Z"))).toBe(true);
    // 06:59 Cairo
    expect(isQuietNow("22:00", "07:00", "Africa/Cairo", at("2026-11-05T04:59:00Z"))).toBe(true);
    // 08:00 Cairo
    expect(isQuietNow("22:00", "07:00", "Africa/Cairo", at("2026-11-05T06:00:00Z"))).toBe(false);
  });

  it("handles a same-day window and its boundaries", () => {
    // 13:00 Cairo is inside 12:00–14:00
    expect(isQuietNow("12:00", "14:00", "Africa/Cairo", at("2026-11-05T11:00:00Z"))).toBe(true);
    // 14:00 sharp is outside (end exclusive)
    expect(isQuietNow("12:00", "14:00", "Africa/Cairo", at("2026-11-05T12:00:00Z"))).toBe(false);
  });

  it("never silences an unknown timezone into silence", () => {
    expect(isQuietNow("22:00", "07:00", "Not/AZone", at("2026-11-05T21:00:00Z"))).toBe(false);
  });
});
