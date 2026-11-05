import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_PUSH_PAYLOAD_BYTES } from "./payload";
import {
  PUSH_TIMEOUT_MS,
  PUSH_TTL_SECONDS,
  isPushConfigured,
  sendPush,
  setPushSenderForTests,
  vapidPublicKey,
} from "./web-push";

const keys = webpush.generateVAPIDKeys();

const target = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: "B".repeat(87),
  auth: "a".repeat(22),
};

const content = { title: "أحمد", body: "عايز أعرف سعر الكشف", tag: "conv:1", kind: "customer_message" };

function stubSender(result: { statusCode: number } | Error) {
  const spy = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  setPushSenderForTests(spy as never);
  return spy;
}

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:ops@excal.uk";
});

afterEach(() => {
  setPushSenderForTests(null);
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it("reads the public key from the runtime env", () => {
    expect(vapidPublicKey()).toBe(keys.publicKey);
    expect(isPushConfigured()).toBe(true);
  });

  it("reports unconfigured when a key is missing", () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(isPushConfigured()).toBe(false);
  });

  it("refuses to send (and never calls the sender) when unconfigured", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const spy = stubSender({ statusCode: 201 });
    const result = await sendPush(target, content);
    expect(result.outcome).toBe("unconfigured");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("outcome classification", () => {
  it("201 → ok", async () => {
    stubSender({ statusCode: 201 });
    expect((await sendPush(target, content)).outcome).toBe("ok");
  });

  it("404 and 410 → gone (the row must be deleted)", async () => {
    stubSender({ statusCode: 410 });
    expect(await sendPush(target, content)).toMatchObject({ outcome: "gone", status: 410 });
    stubSender({ statusCode: 404 });
    expect((await sendPush(target, content)).outcome).toBe("gone");
  });

  it("429 and 5xx → retry", async () => {
    for (const statusCode of [429, 500, 503]) {
      stubSender({ statusCode });
      expect((await sendPush(target, content)).outcome).toBe("retry");
    }
  });

  it("400 / 401 / 403 / 413 → failed, because retrying cannot fix our own request", async () => {
    for (const statusCode of [400, 401, 403, 413]) {
      stubSender({ statusCode });
      expect((await sendPush(target, content)).outcome).toBe("failed");
    }
  });

  it("a thrown network error → retry, never a throw", async () => {
    stubSender(new Error("ECONNRESET"));
    const result = await sendPush(target, content);
    expect(result.outcome).toBe("retry");
    expect(result.detail).toContain("ECONNRESET");
  });
});

describe("ssrf guard", () => {
  it("blocks a non-allowlisted endpoint before any request leaves the box", async () => {
    const spy = stubSender({ statusCode: 201 });
    const result = await sendPush({ ...target, endpoint: "https://169.254.169.254/latest" }, content);
    expect(result.outcome).toBe("blocked");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("request shape", () => {
  it("sends the JSON payload with the protocol limits applied", async () => {
    const spy = stubSender({ statusCode: 201 });
    await sendPush(target, { ...content, body: "كلمة ".repeat(400) }, { topic: "obx-1" });

    const [subscription, payload, options] = spy.mock.calls[0] as unknown as [
      { endpoint: string; keys: { p256dh: string; auth: string } },
      string,
      { TTL: number; timeout: number; topic?: string },
    ];

    expect(subscription.endpoint).toBe(target.endpoint);
    expect(subscription.keys.auth).toBe(target.auth);
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(JSON.parse(payload).title).toBe("أحمد");
    expect(options.TTL).toBe(PUSH_TTL_SECONDS);
    expect(options.timeout).toBe(PUSH_TIMEOUT_MS);
    expect(options.topic).toBe("obx-1");
  });
});
