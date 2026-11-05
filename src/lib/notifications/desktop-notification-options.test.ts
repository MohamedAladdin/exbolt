import { describe, expect, it } from "vitest";

import { desktopNotificationOptions } from "./browser-notify";

/**
 * The desktop alert used to be a plain `{ body, tag, icon }` notification:
 * Chrome/Windows auto-dismissed it after a few seconds and a second message
 * in the same conversation replaced the first with no sound — reported as
 * «الاشعارات بتيجي صامتة». These are the three options that fix that, so a
 * later refactor cannot quietly drop them.
 */
describe("desktopNotificationOptions", () => {
  const content = { title: "Ahmed", body: "هل عندكم مواعيد بكرة؟" };

  it("keeps the banner on screen until the user acts on it", () => {
    expect(desktopNotificationOptions(content, "c1").requireInteraction).toBe(true);
  });

  it("rings again when a newer message replaces the old banner in the same conversation", () => {
    const options = desktopNotificationOptions(content, "c1");
    expect(options.renotify).toBe(true);
    // `renotify` is ignored without a tag — the two travel together or not at all.
    expect(options.tag).toBe("c1");
  });

  it("never asks the OS to mute it", () => {
    expect(desktopNotificationOptions(content, "c1").silent).toBe(false);
  });

  it("carries the built title/body through untouched", () => {
    const options = desktopNotificationOptions(content, "c1");
    expect(options.body).toBe(content.body);
  });
});
