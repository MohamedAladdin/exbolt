import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: a localized screen must pass its own locale to the currency helpers.
 *
 * `currencyName()` / `currencySymbol()` / `searchCurrencies()` default to
 * `appLocale()`, which reads `NEXT_PUBLIC_APP_LOCALE` — a build-time value that
 * is empty on the live box. The picker therefore rendered «EGP · Egyptian
 * Pound» and answered a search for «جنيه» with no results *inside the Arabic
 * UI*, while all 18 unit tests passed because they pass «ar» explicitly
 * (measured on bolt.excal.uk, 2026-11-05).
 *
 * So the assertion is on the call sites, not on the helpers: every component
 * call must carry a locale, and nothing rendered may read the pre-baked
 * `.label` / `.symbol` off `CURRENCIES`. This is what a render test cannot see
 * without a locale-switched browser, and it is the exact shape of the bug.
 */
const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const COMPONENTS = walk(join(SRC, "components")).filter((f) => /\.tsx$/.test(f));

function offenders(pattern: RegExp): string[] {
  return COMPONENTS.filter((file) => {
    const src = readFileSync(file, "utf8");
    // Ignore the doc comments: they quote the broken shape.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    return pattern.test(code);
  }).map((file) => file.slice(SRC.length + 1));
}

describe("currency locale wiring", () => {
  it("never calls a currency helper without an explicit locale", () => {
    // `currencyName(code)` / `searchCurrencies(q)` / `currencySymbol(code)` —
    // a call whose closing paren follows the first argument directly.
    const bare = offenders(/\b(currencyName|currencySymbol)\(\s*[^,()]+\s*\)|\bsearchCurrencies\(\s*[^,()]+\s*\)/);
    expect(bare).toEqual([]);
  });

  it("does not render the pre-baked English label or symbol", () => {
    // Only files that actually consume the catalogue: `.label` is also a form
    // label elsewhere, so the rule is scoped to CURRENCIES consumers.
    const preBaked = COMPONENTS.filter((file) => {
      const src = readFileSync(file, "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      if (!/from\s+"@\/lib\/currency"/.test(code)) return false;
      return /\.(label|symbol)\b/.test(code);
    }).map((file) => file.slice(SRC.length + 1));
    expect(preBaked).toEqual([]);
  });

  it("the picker asks next-intl for the active locale", () => {
    const src = readFileSync(join(SRC, "components/settings/currency-picker.tsx"), "utf8");
    expect(src).toContain("useLocale");
    expect(src).toContain("searchCurrencies(query, locale)");
    expect(src).toContain("currencyName(current.code, locale)");
  });
});
