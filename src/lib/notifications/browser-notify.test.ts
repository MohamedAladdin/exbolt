import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEDUPE_WINDOW_MS,
  clearLegacyBrowserNotifyPref,
  getNotificationPermission,
  readLegacyBrowserNotifyPref,
  shouldNotifyForMessage,
  viewedConversationFromLocation,
  type NotifiableMessage,
} from "./browser-notify";

const NOW = new Date("2026-09-13T10:00:00.000Z").getTime();

function customerMsg(over: Partial<NotifiableMessage> = {}): NotifiableMessage {
  return {
    id: "m1",
    conversation_id: "c1",
    sender_type: "customer",
    content_type: "text",
    content_text: "Hi, is the blue one still in stock?",
    ...over,
  };
}

describe("shouldNotifyForMessage", () => {
  it("notifies for a customer message when the tab is hidden", () => {
    const seen = new Map<string, number>();
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: false,
        viewingConversationId: "c1",
        seen,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("notifies when visible but a different conversation is open", () => {
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: true,
        viewingConversationId: "other",
        seen: new Map(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("notifies when visible on a non-inbox page (no conversation open)", () => {
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: true,
        viewingConversationId: null,
        seen: new Map(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("stays silent when the user is already viewing that conversation", () => {
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: true,
        viewingConversationId: "c1",
        seen: new Map(),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("ignores agent and bot messages", () => {
    for (const sender_type of ["agent", "bot"] as const) {
      const seen = new Map<string, number>();
      expect(
        shouldNotifyForMessage(customerMsg({ sender_type }), {
          documentVisible: false,
          viewingConversationId: null,
          seen,
          now: NOW,
        }),
      ).toBe(false);
      // Our own sends never enter the dedupe map.
      expect(seen.size).toBe(0);
    }
  });

  it("dedupes a replayed INSERT for the same id inside the window", () => {
    const seen = new Map<string, number>();
    const opts = { documentVisible: false, viewingConversationId: null, seen };
    expect(shouldNotifyForMessage(customerMsg(), { ...opts, now: NOW })).toBe(true);
    expect(
      shouldNotifyForMessage(customerMsg(), { ...opts, now: NOW + 1_000 }),
    ).toBe(false);
    // A different message id is unaffected.
    expect(
      shouldNotifyForMessage(customerMsg({ id: "m2" }), { ...opts, now: NOW + 1_000 }),
    ).toBe(true);
  });

  it("forgets an id once the dedupe window has passed", () => {
    const seen = new Map<string, number>();
    const opts = { documentVisible: false, viewingConversationId: null, seen };
    shouldNotifyForMessage(customerMsg(), { ...opts, now: NOW });
    expect(
      shouldNotifyForMessage(customerMsg(), {
        ...opts,
        now: NOW + DEDUPE_WINDOW_MS + 1,
      }),
    ).toBe(true);
    // The stale entry was pruned rather than accumulating forever.
    expect(seen.size).toBe(1);
  });

  it("keeps a suppressed message suppressed if it replays after the user leaves", () => {
    const seen = new Map<string, number>();
    // First arrival: user is looking at the thread -> silent.
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: true,
        viewingConversationId: "c1",
        seen,
        now: NOW,
      }),
    ).toBe(false);
    // Replay 2s later after switching tabs: still the same message.
    expect(
      shouldNotifyForMessage(customerMsg(), {
        documentVisible: false,
        viewingConversationId: null,
        seen,
        now: NOW + 2_000,
      }),
    ).toBe(false);
  });
});

describe("viewedConversationFromLocation", () => {
  it("reads ?c= only on the inbox route", () => {
    expect(viewedConversationFromLocation("/inbox", "?c=abc")).toBe("abc");
    expect(viewedConversationFromLocation("/inbox/", "?c=abc")).toBe("abc");
    expect(viewedConversationFromLocation("/inbox", "")).toBeNull();
    expect(viewedConversationFromLocation("/dashboard", "?c=abc")).toBeNull();
    expect(viewedConversationFromLocation("/inbox-archive", "?c=abc")).toBeNull();
  });
});

describe("browser-only helpers without a window", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("report unsupported / off during SSR", () => {
    expect(typeof window).toBe("undefined");
    expect(getNotificationPermission()).toBe("unsupported");
    expect(readLegacyBrowserNotifyPref()).toBe(false);
    expect(() => clearLegacyBrowserNotifyPref()).not.toThrow();
  });

  it("reads the legacy opt-in flag that the migration consumes", () => {
    const store = new Map<string, string>([["exbolt:browser-notifications", "1"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
      },
    });
    expect(readLegacyBrowserNotifyPref()).toBe(true);
    clearLegacyBrowserNotifyPref();
    expect(readLegacyBrowserNotifyPref()).toBe(false);
  });

  it("report unsupported when window lacks Notification", () => {
    vi.stubGlobal("window", {});
    expect(getNotificationPermission()).toBe("unsupported");
  });
});
