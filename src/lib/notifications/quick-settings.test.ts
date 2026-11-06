import { describe, expect, it } from "vitest";

import { resolveSection } from "@/components/settings/settings-sections";
import { TYPE_KEYS } from "@/lib/push/preferences";
import { NOTIFICATIONS_SETTINGS_HREF, QUICK_TYPE_KEYS } from "./quick-settings";

describe("notifications quick settings", () => {
  it("links to the notifications tab of Settings, not the overview landing", () => {
    const url = new URL(NOTIFICATIONS_SETTINGS_HREF, "https://bolt.example");
    expect(url.pathname).toBe("/settings");
    // The whole point of the button: `?tab=` must resolve to THIS section.
    // A near-miss (`notification`) silently lands on the Overview.
    expect(resolveSection(url.searchParams.get("tab"))).toBe("notifications");
  });

  it("offers a switch for every notifiable type the preferences hold", () => {
    // A fifth type added to the catalogue must appear in the quick card without
    // anyone remembering to edit this module.
    expect(QUICK_TYPE_KEYS).toEqual(TYPE_KEYS);
  });
});
