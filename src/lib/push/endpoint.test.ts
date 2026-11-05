import { describe, expect, it } from "vitest";

import {
  ALLOWED_PUSH_HOSTS,
  MAX_ENDPOINT_LENGTH,
  isAllowedPushEndpoint,
  isPlausibleAuthSecret,
  isPlausibleP256dh,
  normalizeSubscription,
  pushServiceName,
} from "./endpoint";

const P256DH = "B".repeat(87); // 65 bytes base64url — a realistic length
const AUTH = "a".repeat(22); // 16 bytes

function sub(over: Record<string, unknown> = {}) {
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123:def456",
    keys: { p256dh: P256DH, auth: AUTH },
    ...over,
  };
}

describe("isAllowedPushEndpoint", () => {
  it("accepts every real push service", () => {
    const endpoints = [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://android.googleapis.com/gcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
      "https://web.push.apple.com/QGabc",
    ];
    for (const endpoint of endpoints) expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it("rejects plain http — a push endpoint is always TLS", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("rejects a lookalike host that merely contains an allowed name", () => {
    // The classic bypass: `evil-fcm.googleapis.com.attacker.tld`.
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.attacker.tld/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilfcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.tld/x")).toBe(false);
  });

  it("rejects internal targets — this is the SSRF guard", () => {
    for (const endpoint of [
      "https://127.0.0.1/push",
      "https://localhost/push",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.2/admin",
    ]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    }
  });

  it("rejects junk, empty and oversized values", () => {
    expect(isAllowedPushEndpoint("")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
    expect(isAllowedPushEndpoint(null)).toBe(false);
    expect(isAllowedPushEndpoint(42)).toBe(false);
    expect(
      isAllowedPushEndpoint(`https://fcm.googleapis.com/${"a".repeat(MAX_ENDPOINT_LENGTH)}`),
    ).toBe(false);
  });

  it("covers the four browser families and nothing else", () => {
    expect(ALLOWED_PUSH_HOSTS).toHaveLength(5);
  });
});

describe("key plausibility", () => {
  it("accepts realistic base64url blobs", () => {
    expect(isPlausibleP256dh(P256DH)).toBe(true);
    expect(isPlausibleAuthSecret(AUTH)).toBe(true);
  });

  it("rejects padding, spaces, empty and absurd lengths", () => {
    expect(isPlausibleP256dh(`${P256DH}==`)).toBe(false);
    expect(isPlausibleP256dh("short")).toBe(false);
    expect(isPlausibleAuthSecret("")).toBe(false);
    expect(isPlausibleAuthSecret("a".repeat(200))).toBe(false);
  });
});

describe("normalizeSubscription", () => {
  it("returns the three fields we store", () => {
    expect(normalizeSubscription(sub())).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123:def456",
      p256dh: P256DH,
      auth: AUTH,
    });
  });

  it("rejects a subscription with a bad endpoint even when the keys are fine", () => {
    expect(normalizeSubscription(sub({ endpoint: "https://evil.tld/x" }))).toBeNull();
  });

  it("rejects missing or malformed keys", () => {
    expect(normalizeSubscription(sub({ keys: undefined }))).toBeNull();
    expect(normalizeSubscription(sub({ keys: { p256dh: "x", auth: AUTH } }))).toBeNull();
    expect(normalizeSubscription(null)).toBeNull();
    expect(normalizeSubscription("nope")).toBeNull();
  });
});

describe("pushServiceName", () => {
  it("labels the device by the service it belongs to", () => {
    expect(pushServiceName("https://fcm.googleapis.com/fcm/send/x")).toBe("Chrome / Edge");
    expect(pushServiceName("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe("Firefox");
    expect(pushServiceName("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe("Edge (WNS)");
    expect(pushServiceName("https://web.push.apple.com/QGx")).toBe("Safari");
    expect(pushServiceName("garbage")).toBe("Browser");
  });
});
