import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SETTINGS_TABS,
  composeDocumentTitle,
  normalizeSettingsTab,
  resolvePageTitle,
} from "./page-titles";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-sections";

const messages = JSON.parse(
  readFileSync(join(process.cwd(), "messages", "en.json"), "utf8"),
) as { PageTitles?: Record<string, string>; Settings?: { sections?: Record<string, string> } };

/**
 * The catalogue is the only place a page's name is decided, and both the tab
 * title and the shell header read it. These cases pin the two things that were
 * broken before: a page with no entry (the header fell back to «لوحة التحكم»
 * on /flows and /agents) and a branch shadowed by its parent (/flows/:id/runs
 * read as the flow editor).
 */
describe("resolvePageTitle", () => {
  it("names every top-level page", () => {
    const cases: [string, string][] = [
      ["/dashboard", "dashboard"],
      ["/inbox", "inbox"],
      ["/notifications", "notifications"],
      ["/contacts", "contacts"],
      ["/pipelines", "pipelines"],
      ["/broadcasts", "broadcasts"],
      ["/automations", "automations"],
      ["/flows", "flows"],
      ["/agents", "aiAgents"],
      ["/reports", "reports"],
      ["/settings", "settings"],
    ];
    for (const [path, key] of cases) {
      const page = resolvePageTitle(path);
      expect(page, path).not.toBeNull();
      expect(page?.labels[0], path).toEqual({ ns: "Sidebar", key });
    }
  });

  it("keeps a trailing slash working", () => {
    expect(resolvePageTitle("/inbox/")?.labels[0]).toEqual({
      ns: "Sidebar",
      key: "inbox",
    });
  });

  it("only the inbox and object pages take a name", () => {
    expect(resolvePageTitle("/inbox")?.named).toBe(true);
    expect(resolvePageTitle("/flows/abc")?.named).toBe(true);
    expect(resolvePageTitle("/flows/abc/runs")?.named).toBe(true);
    expect(resolvePageTitle("/broadcasts/abc")?.named).toBe(true);
    expect(resolvePageTitle("/team/abc")?.named).toBe(true);
    expect(resolvePageTitle("/automations/abc/edit")?.named).toBe(true);
    expect(resolvePageTitle("/automations/abc/logs")?.named).toBe(true);

    expect(resolvePageTitle("/dashboard")?.named).toBe(false);
    expect(resolvePageTitle("/flows")?.named).toBe(false);
    expect(resolvePageTitle("/broadcasts/new")?.named).toBe(false);
  });

  it("separates a branch from its parent route", () => {
    // `/broadcasts/new` is a branch, not a broadcast called «new».
    expect(resolvePageTitle("/broadcasts/new")?.labels[0]).toEqual({
      ns: "PageTitles",
      key: "newBroadcast",
    });
    expect(resolvePageTitle("/broadcasts/8c1f")?.labels[0]).toEqual({
      ns: "Sidebar",
      key: "broadcasts",
    });

    expect(resolvePageTitle("/flows/abc/runs")?.labels).toEqual([
      { ns: "PageTitles", key: "flowRuns" },
      { ns: "Sidebar", key: "flows" },
    ]);
    expect(resolvePageTitle("/flows/abc")?.labels).toEqual([
      { ns: "Sidebar", key: "flows" },
    ]);

    expect(resolvePageTitle("/automations/abc/edit")?.labels[0]).toEqual({
      ns: "PageTitles",
      key: "editAutomation",
    });
    expect(resolvePageTitle("/automations/abc/logs")?.labels[0]).toEqual({
      ns: "PageTitles",
      key: "automationLogs",
    });
    expect(resolvePageTitle("/automations/new")?.labels[0]).toEqual({
      ns: "PageTitles",
      key: "newAutomation",
    });
  });

  it("names the settings section from the ?tab= branch", () => {
    expect(resolvePageTitle("/settings", "whatsapp")?.labels).toEqual([
      { ns: "Settings", key: "sections.whatsapp" },
      { ns: "Sidebar", key: "settings" },
    ]);
    // An unknown or missing tab is the page itself, not a raw keypath.
    expect(resolvePageTitle("/settings", "nope")?.labels).toEqual([
      { ns: "Sidebar", key: "settings" },
    ]);
    expect(resolvePageTitle("/settings", null)?.labels).toEqual([
      { ns: "Sidebar", key: "settings" },
    ]);
    // Overview IS the page; «نظرة عامة — الإعدادات» would be a duplicate.
    expect(resolvePageTitle("/settings", "overview")?.labels).toEqual([
      { ns: "Sidebar", key: "settings" },
    ]);
    // The tab only applies to /settings.
    expect(resolvePageTitle("/inbox", "whatsapp")?.labels).toEqual([
      { ns: "Sidebar", key: "inbox" },
    ]);
  });

  it("does not match a section by mere prefix collision", () => {
    expect(resolvePageTitle("/inboxes")).toBeNull();
    expect(resolvePageTitle("/teams")).toBeNull();
    expect(resolvePageTitle("/login")).toBeNull();
  });

  it("every label it can return exists in the English catalogue", () => {
    const paths = [
      "/dashboard",
      "/inbox",
      "/notifications",
      "/contacts",
      "/pipelines",
      "/broadcasts",
      "/broadcasts/new",
      "/broadcasts/abc",
      "/automations",
      "/automations/new",
      "/automations/abc/edit",
      "/automations/abc/logs",
      "/flows",
      "/flows/abc",
      "/flows/abc/runs",
      "/agents",
      "/reports",
      "/settings",
      "/team/abc",
    ];
    for (const path of paths) {
      for (const label of resolvePageTitle(path)?.labels ?? []) {
        if (label.ns === "PageTitles") {
          expect(messages.PageTitles?.[label.key], `${path} → ${label.key}`).toBeTruthy();
        }
        if (label.ns === "Settings") {
          const tab = label.key.replace("sections.", "");
          expect(messages.Settings?.sections?.[tab], `${path} → ${label.key}`).toBeTruthy();
        }
      }
    }
  });

  it("the settings tab list stays in step with the settings rail", () => {
    expect([...SETTINGS_TABS]).toEqual([...SETTINGS_SECTIONS]);
    expect(normalizeSettingsTab(" whatsapp ")).toBe("whatsapp");
    expect(normalizeSettingsTab("whatsapp2")).toBeNull();
  });
});

describe("composeDocumentTitle", () => {
  it("puts the object's name first, then the page, then the brand", () => {
    expect(composeDocumentTitle("منى عبد الله", ["صندوق الوارد"], "ExBolt")).toBe(
      "منى عبد الله — صندوق الوارد — ExBolt",
    );
  });

  it("keeps the parent label when there is no name to lead with", () => {
    expect(composeDocumentTitle(null, ["حملة جديدة", "الحملات"], "ExBolt")).toBe(
      "حملة جديدة — الحملات — ExBolt",
    );
  });

  it("drops the parent label once a name leads, to keep the tab short", () => {
    expect(
      composeDocumentTitle("حملة رمضان", ["الحملات", "الحملات"], "ExBolt"),
    ).toBe("حملة رمضان — الحملات — ExBolt");
  });

  it("ignores a blank or whitespace-only name instead of rendering a dash", () => {
    expect(composeDocumentTitle("   ", ["صندوق الوارد"], "ExBolt")).toBe(
      "صندوق الوارد — ExBolt",
    );
    expect(composeDocumentTitle(null, ["صندوق الوارد"], "ExBolt")).toBe(
      "صندوق الوارد — ExBolt",
    );
  });
});
