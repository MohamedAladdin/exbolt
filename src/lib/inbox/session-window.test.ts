import { describe, expect, it } from "vitest";
import { sessionWindow } from "./session-window";

const NOW = new Date("2026-10-31T18:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const inbound = (h: number) => ({ sender_type: "customer", created_at: hoursAgo(h) });
const outbound = (h: number) => ({ sender_type: "agent", created_at: hoursAgo(h) });

describe("sessionWindow", () => {
  it("treats a thread with no customer message as closed (never opened)", () => {
    // The bug: an empty thread answered expired=false, so a first greeting was
    // typed and rejected by Meta with 131047.
    expect(sessionWindow({ messages: [], now: NOW })).toEqual({
      expired: true,
      hoursLeft: 0,
      reason: "never",
    });
    expect(sessionWindow({ lastInboundAt: null, now: NOW }).reason).toBe("never");
    expect(sessionWindow({ messages: [outbound(1)], now: NOW }).expired).toBe(true);
  });

  it("stays open inside 24 hours of the customer's last message", () => {
    const result = sessionWindow({ messages: [inbound(23)], now: NOW });
    expect(result.expired).toBe(false);
    expect(result.hoursLeft).toBeCloseTo(1);
    expect(result.reason).toBe("open");
  });

  it("closes at and after 24 hours", () => {
    expect(sessionWindow({ messages: [inbound(24)], now: NOW })).toEqual({
      expired: true,
      hoursLeft: 0,
      reason: "closed",
    });
    expect(sessionWindow({ messages: [inbound(30)], now: NOW }).reason).toBe("closed");
  });

  it("takes the later of the stored conversation window and the loaded messages", () => {
    // The parent's conversation row can lag behind the realtime insert.
    const result = sessionWindow({
      lastInboundAt: hoursAgo(30),
      messages: [inbound(1)],
      now: NOW,
    });
    expect(result.expired).toBe(false);

    const stale = sessionWindow({
      lastInboundAt: hoursAgo(1),
      messages: [inbound(30)],
      now: NOW,
    });
    expect(stale.expired).toBe(false);
  });

  it("is open from the conversation row alone, before any message is loaded", () => {
    const result = sessionWindow({ lastInboundAt: hoursAgo(2), messages: [], now: NOW });
    expect(result.expired).toBe(false);
    expect(result.reason).toBe("open");
  });

  it("ignores unparseable timestamps instead of crashing", () => {
    expect(sessionWindow({ lastInboundAt: "not-a-date", now: NOW }).reason).toBe("never");
    expect(
      sessionWindow({
        messages: [{ sender_type: "customer", created_at: "nope" }],
        now: NOW,
      }).expired,
    ).toBe(true);
  });
});
