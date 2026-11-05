import { describe, expect, it } from "vitest";

import {
  BODY_MAX_CHARS,
  MAX_PUSH_PAYLOAD_BYTES,
  buildTestPayload,
  fitPushPayload,
  payloadBytes,
  type PushContent,
} from "./payload";

describe("payload size", () => {
  it("keeps an ordinary alert untouched", () => {
    const content: PushContent = { title: "أحمد", body: "عايز أعرف سعر الكشف", tag: "conv:1" };
    expect(fitPushPayload(content)).toEqual(content);
  });

  it("cuts a long body to the copy limit, on a word boundary", () => {
    const fitted = fitPushPayload({
      title: "أحمد",
      body: "كلمة ".repeat(200),
    });
    expect(fitted.body.length).toBeLessThanOrEqual(BODY_MAX_CHARS + 1); // + the ellipsis
    expect(fitted.body.endsWith("…")).toBe(true);
  });

  it("drops url and tag rather than losing the alert", () => {
    // A title + body that alone nearly fills the budget, plus a fat url.
    const fitted = fitPushPayload({
      title: "أحمد",
      body: "نص",
      url: `/inbox?c=${"a".repeat(MAX_PUSH_PAYLOAD_BYTES)}`,
      tag: "x".repeat(500),
      kind: "customer_message",
    });
    expect(payloadBytes(fitted)).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(fitted.title).toBe("أحمد");
    expect(fitted.url).toBeUndefined();
    expect(fitted.kind).toBe("customer_message");
  });

  it("never returns something over the wire limit", () => {
    const huge = fitPushPayload({ title: "x".repeat(5_000), body: "y".repeat(5_000) });
    expect(payloadBytes(huge)).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
  });

  it("measures UTF-8 bytes, not characters — Arabic is 2 bytes a letter", () => {
    expect(payloadBytes({ title: "عربي", body: "" })).toBeGreaterThan(
      JSON.stringify({ title: "عربي", body: "" }).length - 4,
    );
  });
});

describe("buildTestPayload", () => {
  it("is localized and deep-links to the settings tab", () => {
    const ar = buildTestPayload("ar");
    const en = buildTestPayload("en");
    expect(ar.title).toContain("الإشعارات");
    expect(en.title).toContain("Notifications");
    expect(ar.url).toBe("/settings?tab=notifications");
    expect(ar.tag).toBe("exbolt-test");
    expect(ar.kind).toBe("test");
    expect(ar.body).not.toBe(en.body);
  });

  it("falls back to Arabic for an unexpected locale", () => {
    // @ts-expect-error deliberately wrong locale from the wire
    expect(buildTestPayload("fr").title).toBe(buildTestPayload("ar").title);
  });
});
