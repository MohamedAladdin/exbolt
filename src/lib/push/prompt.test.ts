import { describe, expect, it } from "vitest";

import {
  PROMPT_MAX_DISMISSALS,
  PROMPT_REMIND_AFTER_MS,
  shouldShowPushPrompt,
} from "./prompt";

const NOW = new Date("2026-11-05T10:00:00Z").getTime();

function decide(over: Partial<Parameters<typeof shouldShowPushPrompt>[0]> = {}) {
  return shouldShowPushPrompt({
    permission: "default",
    subscribed: false,
    dismissals: 0,
    dismissedAt: null,
    now: NOW,
    ...over,
  });
}

describe("shouldShowPushPrompt", () => {
  it("asks a fresh device whose permission is undecided", () => {
    expect(decide()).toMatchObject({ show: true, variant: "enable", reason: "permission_default" });
  });

  it("asks when permission is granted but this device never subscribed", () => {
    expect(decide({ permission: "granted" })).toMatchObject({
      show: true,
      reason: "permission_granted_not_subscribed",
    });
  });

  it("stays out of the way once the device is subscribed", () => {
    expect(decide({ permission: "granted", subscribed: true })).toMatchObject({
      show: false,
      reason: "already_subscribed",
    });
  });

  it("explains a browser-level block once, offering no button", () => {
    expect(decide({ permission: "denied" })).toMatchObject({
      show: true,
      variant: "denied",
      reason: "permission_denied",
    });
    // …and never again after it is dismissed.
    expect(decide({ permission: "denied", dismissals: 1 })).toMatchObject({
      show: false,
      reason: "dismissed_for_good",
    });
  });

  it("does not nag: a dismissal silences it for the reminder window", () => {
    expect(
      decide({ dismissals: 1, dismissedAt: NOW - 24 * 60 * 60 * 1000 }),
    ).toMatchObject({ show: false, reason: "dismissed_recently" });

    expect(
      decide({ dismissals: 1, dismissedAt: NOW - (PROMPT_REMIND_AFTER_MS + 1) }),
    ).toMatchObject({ show: true, variant: "enable" });
  });

  it("gives up after the second dismissal", () => {
    expect(
      decide({ dismissals: PROMPT_MAX_DISMISSALS, dismissedAt: NOW - PROMPT_REMIND_AFTER_MS * 2 }),
    ).toMatchObject({ show: false, reason: "dismissed_for_good" });
  });

  it("never shows anything where push cannot work at all", () => {
    expect(decide({ permission: "unsupported" })).toMatchObject({
      show: false,
      reason: "unsupported",
    });
  });

  it("treats garbage dismissal counters as zero", () => {
    expect(decide({ dismissals: Number.NaN })).toMatchObject({ show: true });
    expect(decide({ dismissals: -3 })).toMatchObject({ show: true });
  });
});
