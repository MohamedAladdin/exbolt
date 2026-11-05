import { describe, expect, it } from "vitest";

import {
  CHIME_GAIN,
  CHIME_NOTES,
  CHIME_THROTTLE_MS,
  playNotificationChime,
  readSoundPref,
  shouldPlaySound,
  writeSoundPref,
} from "./sound";

const NOW = 1_700_000_000_000;

describe("shouldPlaySound", () => {
  it("plays when the preference is on and nothing has rung yet", () => {
    expect(shouldPlaySound({ enabled: true, lastPlayedAt: null, now: NOW })).toBe(
      true,
    );
  });

  it("stays quiet when the device muted the chime", () => {
    expect(shouldPlaySound({ enabled: false, lastPlayedAt: null, now: NOW })).toBe(
      false,
    );
  });

  it("swallows a burst: a second alert inside the throttle window is silent", () => {
    expect(
      shouldPlaySound({
        enabled: true,
        lastPlayedAt: NOW - (CHIME_THROTTLE_MS - 1),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rings again once the window has passed", () => {
    expect(
      shouldPlaySound({
        enabled: true,
        lastPlayedAt: NOW - CHIME_THROTTLE_MS,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("the chime itself", () => {
  it("is a rising two-note figure — a ding-dong, not a siren", () => {
    expect(CHIME_NOTES).toHaveLength(2);
    expect(CHIME_NOTES[0].frequency).toBeLessThan(CHIME_NOTES[1].frequency);
    expect(CHIME_NOTES[0].offset).toBeLessThan(CHIME_NOTES[1].offset);
  });

  it("peaks well below clipping, so it never startles", () => {
    expect(CHIME_GAIN).toBeGreaterThan(0);
    expect(CHIME_GAIN).toBeLessThan(0.5);
  });
});

describe("preference storage", () => {
  it("defaults to ON — an alert that has to be switched on is still a silent one", () => {
    // node env: no window, which is also the SSR path.
    expect(readSoundPref()).toBe(true);
  });

  it("no-ops instead of throwing during SSR", () => {
    expect(() => writeSoundPref(false)).not.toThrow();
    expect(() => writeSoundPref(true)).not.toThrow();
  });

  it("returns false rather than throwing where there is no AudioContext", () => {
    expect(playNotificationChime()).toBe(false);
  });
});
