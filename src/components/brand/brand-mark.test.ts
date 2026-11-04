import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: one logo, everywhere.
 *
 * The product's own screens (login, signup, reset, dashboard sidebar) and the
 * favicon must all draw the ExBolt blue bolt. They used to draw EXCAL's gold
 * "E" plate, i.e. the homepage and the login page advertised two logos, and
 * the drift came back twice because nothing mechanical held the line.
 *
 * These are source-shape assertions on purpose: the mark is a static SVG, so
 * a render test would only prove React mounted something — what actually
 * regresses is which component a page imports.
 */
const SRC = join(process.cwd(), "src");

function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("ExBolt mark", () => {
  it("is the only brand mark the app imports", () => {
    const offenders = walk(SRC)
      .filter((file) => !file.includes("brand-mark.test"))
      .filter((file) => readFileSync(file, "utf8").includes("brand/excal-mark"))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it("draws the brand blue and the bolt, not the gold plate", () => {
    const mark = read("components/brand/exbolt-mark.tsx");
    expect(mark).toContain("#0A4DFF");
    expect(mark).not.toContain("#F5C242");
    // the bolt path starts at 37/11 in the 64-unit grid
    expect(mark).toContain("M37 11");
  });

  it("renders the blue bolt as the favicon and the iOS icon", () => {
    for (const file of ["app/icon.tsx", "app/apple-icon.tsx"]) {
      const source = read(file);
      expect(source, file).toContain("#0A4DFF");
      expect(source, file).not.toContain("#F5C242");
    }
  });

  it("is what the auth screens and the dashboard shell render", () => {
    for (const file of [
      "app/(auth)/login/page.tsx",
      "app/(auth)/signup/page.tsx",
      "app/(auth)/forgot-password/page.tsx",
      "components/layout/sidebar.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("ExboltMark");
      expect(source, file).not.toContain("ExcalMark");
    }
  });
});
