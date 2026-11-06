import { describe, expect, it } from "vitest";

import { DEFAULT_PREFERENCES, type NotificationPreferences } from "@/lib/push/preferences";
import {
  alertTypeForRow,
  desktopAlertAllowed,
  inAppAlertAllowed,
  isQuietNow,
  type AlertContext,
} from "./gate";

const NOON = new Date("2026-11-06T12:00:00");

function ctx(over: Partial<AlertContext> = {}): AlertContext {
  return {
    prefs: { ...DEFAULT_PREFERENCES },
    permission: "granted",
    deviceSubscribed: true,
    now: NOON,
    ...over,
  };
}

function prefs(over: Partial<NotificationPreferences>): NotificationPreferences {
  return { ...DEFAULT_PREFERENCES, ...over };
}

describe("alertTypeForRow", () => {
  it("maps the table's vocabulary onto the operator's switches", () => {
    expect(alertTypeForRow("conversation_assigned")).toBe("conversation_assigned");
    expect(alertTypeForRow("ai_handoff_unassigned")).toBe("ai_handoff");
    expect(alertTypeForRow("report_alert")).toBe("report_alert");
  });

  it("does not invent a gate for an unknown row type", () => {
    expect(alertTypeForRow("something_new")).toBeNull();
  });
});

describe("isQuietNow", () => {
  it("respects a window that wraps midnight", () => {
    const p = prefs({ quiet_from: "22:00", quiet_to: "08:00" });
    expect(isQuietNow(p, new Date("2026-11-06T23:30:00"))).toBe(true);
    expect(isQuietNow(p, new Date("2026-11-06T07:59:00"))).toBe(true);
    expect(isQuietNow(p, new Date("2026-11-06T12:00:00"))).toBe(false);
  });

  it("is off when unset", () => {
    expect(isQuietNow(prefs({}), NOON)).toBe(false);
  });
});

describe("inAppAlertAllowed", () => {
  it("is on by default", () => {
    expect(inAppAlertAllowed(ctx().prefs, "customer_message", NOON)).toBe(true);
  });

  it("stops for the whole channel when in-app alerts are off", () => {
    expect(inAppAlertAllowed(prefs({ in_app_alerts: false }), "customer_message", NOON)).toBe(
      false,
    );
  });

  it("stops per type — the popup must obey the same switch as the phone", () => {
    const p = prefs({ conversation_assigned: false });
    expect(inAppAlertAllowed(p, "conversation_assigned", NOON)).toBe(false);
    expect(inAppAlertAllowed(p, "customer_message", NOON)).toBe(true);
  });

  it("stays silent during quiet hours", () => {
    const p = prefs({ quiet_from: "00:00", quiet_to: "23:59" });
    expect(inAppAlertAllowed(p, "customer_message", NOON)).toBe(false);
  });

  it("does not need a push subscription — the card is the in-app channel", () => {
    expect(inAppAlertAllowed(ctx().prefs, "customer_message", NOON)).toBe(true);
  });
});

describe("desktopAlertAllowed", () => {
  it("is on only when every switch and the device agree", () => {
    expect(desktopAlertAllowed(ctx(), "customer_message")).toBe(true);
  });

  it("turns off with the device switch — the reported bug", () => {
    expect(desktopAlertAllowed(ctx({ deviceSubscribed: false }), "customer_message")).toBe(false);
  });

  it("turns off with the out-of-app channel switch", () => {
    expect(desktopAlertAllowed(ctx({ prefs: prefs({ push_enabled: false }) }), "customer_message")).toBe(
      false,
    );
  });

  it("turns off per type", () => {
    const c = ctx({ prefs: prefs({ ai_handoff: false }) });
    expect(desktopAlertAllowed(c, "ai_handoff")).toBe(false);
    expect(desktopAlertAllowed(c, "customer_message")).toBe(true);
  });

  it("never fires without browser permission", () => {
    expect(desktopAlertAllowed(ctx({ permission: "default" }), "customer_message")).toBe(false);
    expect(desktopAlertAllowed(ctx({ permission: "denied" }), "customer_message")).toBe(false);
    expect(desktopAlertAllowed(ctx({ permission: "unsupported" }), "customer_message")).toBe(false);
  });

  it("never fires during quiet hours", () => {
    const c = ctx({ prefs: prefs({ quiet_from: "00:00", quiet_to: "23:59" }) });
    expect(desktopAlertAllowed(c, "customer_message")).toBe(false);
  });
});
