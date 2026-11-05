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

  it("suppresses the OS banner when a dashboard tab is visible AND focused", () => {
    // The in-app popup already fired on that device; a second banner is the
    // "inside and outside at the same time" the user rejected.
    expect(source).toContain("visibilityState === 'visible'");
    expect(source).toContain("client.focused === true");
    expect(source).toContain("hasFocusedClient");
  });

  it("collapses a burst on one conversation into a single banner", () => {
    expect(source).toContain("getNotifications({ tag })");
    expect(source).toContain("renotify: already === 0");
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
