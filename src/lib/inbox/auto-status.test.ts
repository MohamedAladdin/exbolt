import { describe, expect, it } from "vitest";
import type { Conversation } from "@/types";
import {
  DEFAULT_AUTO_CLOSE_DAYS,
  autoStatusFor,
  isWaitingOnUs,
  normaliseCloseAfterDays,
} from "./auto-status";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const days = (n: number) => ago(n * 24);

function conv(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    user_id: "u",
    contact_id: "k1",
    status: "open",
    unread_count: 0,
    created_at: days(40),
    updated_at: ago(1),
    last_inbound_at: ago(2),
    last_reply_at: ago(1),
    last_message_at: ago(1),
    ...patch,
  };
}

const sweep = (c: Conversation, closeAfterDays = DEFAULT_AUTO_CLOSE_DAYS) =>
  autoStatusFor(c, { now: NOW, closeAfterDays });

describe("autoStatusFor — pending", () => {
  it("flags an open thread whose 24h window lapsed, even if we replied", () => {
    expect(
      sweep(conv({ last_inbound_at: ago(25), last_reply_at: ago(24), last_message_at: ago(24) })),
    ).toBe("pending");
  });

  it("leaves a thread inside the window open", () => {
    expect(sweep(conv({ last_inbound_at: ago(23) }))).toBeNull();
  });

  it("never flips a thread the customer never wrote in", () => {
    expect(
      sweep(conv({ last_inbound_at: null, last_reply_at: ago(5), last_message_at: ago(5) })),
    ).toBeNull();
  });

  it("keeps pending threads pending (no repeat write)", () => {
    expect(sweep(conv({ status: "pending", last_inbound_at: ago(30) }))).toBeNull();
  });
});

describe("autoStatusFor — closed", () => {
  it("closes a thread idle past the account threshold", () => {
    expect(sweep(conv({ last_inbound_at: days(20), last_reply_at: days(19), last_message_at: days(19) }))).toBe("closed");
    expect(sweep(conv({ status: "pending", last_inbound_at: days(16), last_message_at: days(15) }))).toBe("closed");
  });

  it("counts the threshold from the last message, not from updated_at", () => {
    expect(
      sweep(conv({ last_message_at: days(5), updated_at: days(90) })),
    ).toBeNull();
  });

  it("honours a custom threshold", () => {
    const c = conv({ last_inbound_at: days(8), last_reply_at: days(7), last_message_at: days(7) });
    expect(sweep(c, 7)).toBe("closed");
    // Not old enough to retire, but the 24h window is long gone → pending.
    expect(sweep(c, 14)).toBe("pending");
  });

  it("leaves an already closed thread alone", () => {
    expect(sweep(conv({ status: "closed", last_message_at: days(60) }))).toBeNull();
  });
});

describe("autoStatusFor — guards", () => {
  it("refuses to retire a thread with unread messages", () => {
    expect(
      sweep(conv({ unread_count: 2, last_inbound_at: days(30), last_message_at: days(30) })),
    ).toBeNull();
  });

  it("refuses to retire a thread waiting on our reply", () => {
    expect(
      sweep(conv({ last_inbound_at: days(30), last_reply_at: days(31), last_message_at: days(30) })),
    ).toBeNull();
    expect(
      sweep(conv({ last_inbound_at: days(30), last_reply_at: null, last_message_at: days(30) })),
    ).toBeNull();
  });

  it("survives a thread with no timestamps at all", () => {
    expect(
      sweep(conv({ last_inbound_at: null, last_reply_at: null, last_message_at: undefined })),
    ).toBeNull();
  });
});

describe("isWaitingOnUs", () => {
  it("treats a customer-only thread as waiting on us", () => {
    expect(isWaitingOnUs(conv({ last_reply_at: null }))).toBe(true);
    expect(isWaitingOnUs(conv({ last_inbound_at: ago(1), last_reply_at: ago(2) }))).toBe(true);
    expect(isWaitingOnUs(conv({ last_inbound_at: ago(2), last_reply_at: ago(1) }))).toBe(false);
    expect(isWaitingOnUs(conv({ last_inbound_at: null }))).toBe(false);
  });
});

describe("normaliseCloseAfterDays", () => {
  it("clamps into 1..90 and falls back to the default", () => {
    expect(normaliseCloseAfterDays(14)).toBe(14);
    expect(normaliseCloseAfterDays("21")).toBe(21);
    expect(normaliseCloseAfterDays(0)).toBe(1);
    expect(normaliseCloseAfterDays(-5)).toBe(1);
    expect(normaliseCloseAfterDays(400)).toBe(90);
    expect(normaliseCloseAfterDays(null)).toBe(DEFAULT_AUTO_CLOSE_DAYS);
    expect(normaliseCloseAfterDays(undefined)).toBe(DEFAULT_AUTO_CLOSE_DAYS);
    expect(normaliseCloseAfterDays("abc")).toBe(DEFAULT_AUTO_CLOSE_DAYS);
  });
});
