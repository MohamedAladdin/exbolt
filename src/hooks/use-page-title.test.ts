import { describe, expect, it } from "vitest";

import { routeTitleKey } from "./use-page-title";

describe("routeTitleKey", () => {
  it("names every top-level product page", () => {
    expect(routeTitleKey("/inbox")).toBe("inbox");
    expect(routeTitleKey("/contacts")).toBe("contacts");
    expect(routeTitleKey("/pipelines")).toBe("pipelines");
    expect(routeTitleKey("/broadcasts")).toBe("broadcasts");
    expect(routeTitleKey("/automations")).toBe("automations");
    expect(routeTitleKey("/flows")).toBe("flows");
    expect(routeTitleKey("/agents")).toBe("aiAgents");
    expect(routeTitleKey("/reports")).toBe("reports");
    expect(routeTitleKey("/settings")).toBe("settings");
    expect(routeTitleKey("/notifications")).toBe("notifications");
    expect(routeTitleKey("/dashboard")).toBe("dashboard");
  });

  it("resolves nested routes to their section", () => {
    expect(routeTitleKey("/inbox/abc")).toBe("inbox");
    expect(routeTitleKey("/flows/123/runs")).toBe("flows");
    expect(routeTitleKey("/team/some-user")).toBe("settings");
  });

  it("does not match a section by mere prefix collision", () => {
    // `/inboxes` is not `/inbox`.
    expect(routeTitleKey("/inboxes")).toBeNull();
  });

  it("returns null for a route with no product name (the brand stays)", () => {
    expect(routeTitleKey("/login")).toBeNull();
  });
});
