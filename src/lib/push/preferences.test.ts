import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  isWithinQuietHours,
  isValidQuietTime,
  normalizePreferencePatch,
  preferencesFromRow,
} from "./preferences";

describe("normalizePreferencePatch", () => {
  it("accepts real booleans for channels and types", () => {
    const { patch, invalid } = normalizePreferencePatch({
      push_enabled: false,
      in_app_alerts: true,
      customer_message: false,
      ai_handoff: false,
    });
    expect(invalid).toEqual([]);
    expect(patch).toEqual({
      push_enabled: false,
      in_app_alerts: true,
      customer_message: false,
      ai_handoff: false,
    });
  });

  it("rejects a stringified boolean instead of storing an 'on' switch that behaves off", () => {
    const { patch, invalid } = normalizePreferencePatch({ push_enabled: "false" });
    expect(invalid).toEqual(["push_enabled"]);
    expect(patch.push_enabled).toBeUndefined();
  });

  it("ignores unknown keys (an older build must not 400 a newer client)", () => {
    const { patch, invalid } = normalizePreferencePatch({ future_flag: true, ai_handoff: true });
    expect(invalid).toEqual([]);
    expect(patch).toEqual({ ai_handoff: true });
  });

  it("accepts only the three preview modes", () => {
    expect(normalizePreferencePatch({ push_preview: "name" }).patch.push_preview).toBe("name");
    expect(normalizePreferencePatch({ push_preview: "everything" }).invalid).toEqual([
      "push_preview",
    ]);
  });

  it("requires both quiet-hour ends, or neither", () => {
    expect(normalizePreferencePatch({ quiet_from: "22:00", quiet_to: "08:00" }).patch).toEqual({
      quiet_from: "22:00",
      quiet_to: "08:00",
    });
    expect(normalizePreferencePatch({ quiet_from: null, quiet_to: null }).patch).toEqual({
      quiet_from: null,
      quiet_to: null,
    });
    // Half a window is not a window.
    expect(normalizePreferencePatch({ quiet_from: "22:00", quiet_to: null }).invalid).toEqual([
      "quiet_range",
    ]);
  });

  it("rejects malformed times", () => {
    expect(normalizePreferencePatch({ quiet_from: "25:00", quiet_to: "08:00" }).invalid).toContain(
      "quiet_from",
    );
    expect(normalizePreferencePatch({ quiet_from: "8:00", quiet_to: "17:00" }).invalid).toContain(
      "quiet_from",
    );
  });

  it("rejects a non-object body", () => {
    expect(normalizePreferencePatch(null).invalid).toEqual(["body"]);
    expect(normalizePreferencePatch([1, 2]).invalid).toEqual(["body"]);
  });
});

describe("quiet hours", () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m);

  it("handles a window inside one day", () => {
    const prefs = { quiet_from: "09:00", quiet_to: "17:00" };
    expect(isWithinQuietHours(prefs, at(8, 59))).toBe(false);
    expect(isWithinQuietHours(prefs, at(9, 0))).toBe(true);
    expect(isWithinQuietHours(prefs, at(16, 59))).toBe(true);
    expect(isWithinQuietHours(prefs, at(17, 0))).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    const prefs = { quiet_from: "22:00", quiet_to: "08:00" };
    expect(isWithinQuietHours(prefs, at(21, 59))).toBe(false);
    expect(isWithinQuietHours(prefs, at(23, 30))).toBe(true);
    expect(isWithinQuietHours(prefs, at(2, 0))).toBe(true);
    expect(isWithinQuietHours(prefs, at(7, 59))).toBe(true);
    expect(isWithinQuietHours(prefs, at(8, 0))).toBe(false);
  });

  it("treats an empty or zero-length window as off", () => {
    expect(isWithinQuietHours({ quiet_from: null, quiet_to: null }, at(23))).toBe(false);
    expect(isWithinQuietHours({ quiet_from: "22:00", quiet_to: "22:00" }, at(22))).toBe(false);
  });
});

describe("preferencesFromRow", () => {
  it("returns the defaults for a user with no row", () => {
    expect(preferencesFromRow(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps stored values and fills the gaps", () => {
    const prefs = preferencesFromRow({ push_enabled: false, quiet_from: null, quiet_to: null });
    expect(prefs.push_enabled).toBe(false);
    expect(prefs.ai_handoff).toBe(true);
    expect(prefs.push_preview).toBe("name");
  });

  it("validates the HH:MM shape", () => {
    expect(isValidQuietTime("00:00")).toBe(true);
    expect(isValidQuietTime("23:59")).toBe(true);
    expect(isValidQuietTime("24:00")).toBe(false);
    expect(isValidQuietTime("7:05")).toBe(false);
    expect(isValidQuietTime(2200)).toBe(false);
  });
});
