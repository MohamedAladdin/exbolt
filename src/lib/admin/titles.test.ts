import { describe, expect, it } from "vitest";

import { adminTitleKey, composeAdminTitle } from "./titles";

describe("adminTitleKey", () => {
  it("names every console page", () => {
    expect(adminTitleKey("/admin")).toBe("nav.overview");
    expect(adminTitleKey("/admin/inquiries")).toBe("inquiries.title");
    expect(adminTitleKey("/admin/requests")).toBe("nav.requests");
    expect(adminTitleKey("/admin/landing")).toBe("nav.landing");
    expect(adminTitleKey("/admin/accounts")).toBe("accounts.title");
    expect(adminTitleKey("/admin/billing")).toBe("billing.title");
    expect(adminTitleKey("/admin/channels")).toBe("nav.channels");
    expect(adminTitleKey("/admin/audit")).toBe("nav.audit");
    expect(adminTitleKey("/admin/settings")).toBe("nav.settings");
  });

  it("resolves the account detail branch, not its list", () => {
    expect(adminTitleKey("/admin/accounts/6f1c2d3e")).toBe("accounts.detail");
  });

  it("does not match a console page by mere prefix collision", () => {
    expect(adminTitleKey("/administrator")).toBeNull();
    expect(adminTitleKey("/adminx/accounts")).toBeNull();
  });

  it("returns null outside the console, so the app's own title stands", () => {
    expect(adminTitleKey("/dashboard")).toBeNull();
  });
});

describe("composeAdminTitle", () => {
  it("puts the page name in front of the console's own name", () => {
    expect(composeAdminTitle("الحسابات", "ExBolt · لوحة التحكم")).toBe(
      "الحسابات — ExBolt · لوحة التحكم",
    );
  });

  it("falls back to the console name when the page name is blank", () => {
    expect(composeAdminTitle("  ", "ExBolt · لوحة التحكم")).toBe(
      "ExBolt · لوحة التحكم",
    );
  });
});
