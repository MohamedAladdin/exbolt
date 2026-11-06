import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `public/sw.js` is plain JS served straight to the browser — no bundler, no types,
 * no test runner. These assertions are the only thing standing between a passing
 * suite and a worker that silently stops showing notifications, so they pin the
 * behaviours the product decided on rather than the implementation.
 */

const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

describe("service worker — the contract", () => {
  it("handles push and the click that follows it", () => {
    expect(source).toContain("addEventListener('push'");
    expect(source).toContain("addEventListener('notificationclick'");
    expect(source).toContain("showNotification(");
    expect(source).toContain("clients.openWindow(");
  });

  it("has NO fetch handler — it must never sit in the request path of the app", () => {
    expect(source).not.toContain("addEventListener('fetch'");
    expect(source).not.toContain('addEventListener("fetch"');
  });

  it("stays quiet only for the thread the user is already reading", () => {
    // The banner is redundant when that exact conversation is on screen. Being on a
    // different page is NOT "already seen" — a focused tab elsewhere still gets one.
    expect(source).toContain("visibilityState === 'visible'");
    expect(source).toContain("client.focused === true");
    expect(source).toContain("isViewingConversation");
    expect(source).toContain("searchParams.get('c')");
    expect(source).toContain("if (payload.kind === 'customer_message') return true");
  });

  it("lets the in-app card own alerts that have one", () => {
    // Assignment / handoff / report rows render a sonner card on a focused device;
    // a banner on top of it is the "inside and outside at once" the user rejected.
    expect(source).toContain("POPUP_KINDS");
    expect(source).toContain("conversation_assigned");
    expect(source).toContain("report_alert");
  });

  it("but never suppresses the explicit test notification", () => {
    // The test button is pressed while looking at the screen; a suppressed test
    // reads as «الإشعارات مش شغالة».
    expect(source).toContain("payload.kind === 'test'");
  });

  it("collapses a burst on one conversation into a single banner", () => {
    expect(source).toContain("getNotifications({ tag })");
    expect(source).toContain("renotify: already === 0");
  });

  it("dismisses its own banner after a limited time", () => {
    // The reported bug: the banner sat on screen until it was closed by hand.
    // So `requireInteraction` may never be true again, and the worker closes what
    // it showed instead of waiting for the user.
    expect(source).toContain("const CLOSE_AFTER_MS = 10_000");
    expect(source).toContain("dismissAfterDelay");
    expect(source).toContain("notification.close()");
    expect(source).toContain("requireInteraction: false");
    expect(source).not.toContain("requireInteraction: true");
  });

  it("leaves the OS sound to the tab when one is open", () => {
    // A panel that is open plays the product chime; ringing twice is not "louder".
    expect(source).toContain("silent: clients.length > 0");
  });

  it("re-subscribes when the browser rotates the subscription", () => {
    expect(source).toContain("pushsubscriptionchange");
    expect(source).toContain("/api/push/subscribe");
  });

  it("only ever focuses/navigates same-origin paths carried in the payload", () => {
    expect(source).toContain("data: { url: payload.url || '/notifications'");
    expect(source).toContain("'navigate' in client");
  });
});
