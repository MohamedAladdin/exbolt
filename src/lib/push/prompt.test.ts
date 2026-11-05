import { describe, expect, it } from "vitest";

import { shouldShowPushPrompt } from "./prompt";

function decide(over: Partial<Parameters<typeof shouldShowPushPrompt>[0]> = {}) {
  return shouldShowPushPrompt({
    permission: "default",
    subscribed: false,
    hiddenThisSession: false,
    ...over,
  });
}

/**
 * The product decision: while this device cannot receive alerts, the reminder is
 * persistent. «ليس الآن» only buys the current session — a device with notifications
 * off is a customer waiting for a reply nobody hears about.
 */
describe("shouldShowPushPrompt", () => {
  it("asks a device whose permission is undecided", () => {
    expect(decide()).toMatchObject({ show: true, variant: "enable", reason: "permission_default" });
  });

  it("asks when permission is granted but this device never subscribed", () => {
    expect(decide({ permission: "granted" })).toMatchObject({
      show: true,
      variant: "enable",
      reason: "permission_granted_not_subscribed",
    });
  });

  it("stays out of the way once the device is subscribed", () => {
    expect(decide({ permission: "granted", subscribed: true })).toMatchObject({
      show: false,
      reason: "already_subscribed",
    });
  });

  it("hides only for the session after «ليس الآن» — it comes back next sign-in", () => {
    expect(decide({ hiddenThisSession: true })).toMatchObject({
      show: false,
      reason: "hidden_this_session",
    });
    // The same device is asked again in a new session.
    expect(decide({ hiddenThisSession: false })).toMatchObject({ show: true });
  });

  it("explains a browser-level block with no button, and keeps explaining it", () => {
    expect(decide({ permission: "denied" })).toMatchObject({
      show: true,
      variant: "denied",
      reason: "permission_denied",
    });
    // Not "dismissed for good": the next session still explains the fix.
    expect(decide({ permission: "denied", hiddenThisSession: false })).toMatchObject({
      show: true,
      variant: "denied",
    });
  });

  it("never shows anything where push cannot work at all", () => {
    expect(decide({ permission: "unsupported" })).toMatchObject({
      show: false,
      reason: "unsupported",
    });
    expect(decide({ permission: "unsupported", subscribed: true })).toMatchObject({ show: false });
  });

  it("prefers silence over a banner on a subscribed device, whatever the permission says", () => {
    expect(decide({ permission: "default", subscribed: true })).toMatchObject({
      show: false,
      reason: "already_subscribed",
    });
  });
});
