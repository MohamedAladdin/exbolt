import { describe, expect, it } from "vitest";
import {
  ARAB_CURRENCIES,
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencyName,
  formatCurrency,
  formatCurrencyShort,
  isCurrencyCode,
  searchCurrencies,
} from "./currency";

describe("catalogue coverage", () => {
  it("every code is structurally valid ISO-4217 and unique", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code, code).toMatch(/^[A-Z]{3}$/);
      expect(isCurrencyCode(code)).toBe(true);
    }
  });

  it("offers every Arab-world currency the old 15-code list was missing", () => {
    const codes = new Set(CURRENCIES.map((c) => c.code));
    for (const code of [
      "EGP", "SAR", "KWD", "QAR", "BHD", "OMR", "JOD", "IQD",
      "LBP", "MAD", "TND", "DZD", "LYD", "SDG", "YER", "SYP",
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
    expect(ARAB_CURRENCIES.slice(0, 6)).toEqual(["EGP", "SAR", "AED", "KWD", "QAR", "BHD"]);
  });

  it("names an Arab currency in Arabic when the UI is Arabic", () => {
    expect(currencyName("EGP", "ar")).toBe("جنيه مصري");
    expect(currencyName("SAR", "ar")).toBe("ريال سعودي");
    expect(currencyName("EGP", "en")).toBe("Egyptian Pound");
    expect(currencyName("XYZ", "en")).toBe("XYZ");
  });
});

describe("searchCurrencies", () => {
  it("returns the whole catalogue for an empty query", () => {
    expect(searchCurrencies("")).toHaveLength(CURRENCIES.length);
    expect(searchCurrencies("   ")).toHaveLength(CURRENCIES.length);
  });

  it("finds by code, case-insensitively", () => {
    expect(searchCurrencies("egp").map((c) => c.code)).toContain("EGP");
  });

  it("finds an Arab currency by its Arabic name", () => {
    const codes = searchCurrencies("جنيه", "ar").map((c) => c.code);
    expect(codes).toContain("EGP");
    // «جنيه سوداني» — and note SYP/LBP are «ليرة» in Arabic, not «جنيه».
    expect(codes).toContain("SDG");
    expect(searchCurrencies("ليرة", "ar").map((c) => c.code)).toEqual(
      expect.arrayContaining(["SYP", "LBP", "TRY"]),
    );
  });

  it("finds by English name even in the Arabic UI", () => {
    const codes = searchCurrencies("dinar", "ar").map((c) => c.code);
    expect(codes).toEqual(
      expect.arrayContaining(["KWD", "BHD", "JOD", "IQD", "TND", "DZD", "LYD"]),
    );
  });

  it("returns nothing for a query no currency answers", () => {
    expect(searchCurrencies("zzzzz")).toHaveLength(0);
  });
});

describe("formatCurrency", () => {
  it("formats whole amounts with no minor units", () => {
    // Use a non-breaking-space-tolerant check: Intl may insert NBSP.
    const out = formatCurrency(1234, "USD");
    expect(out).toContain("1,234");
    expect(out).not.toContain(".00");
  });

  it("defaults to USD when no currency is given", () => {
    expect(formatCurrency(10)).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it("treats an empty-string currency as the default", () => {
    expect(formatCurrency(10, "")).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it("coerces non-finite values to 0", () => {
    expect(formatCurrency(Number.NaN, "USD")).toContain("0");
  });

  it("renders a well-formed but unknown ISO code without throwing", () => {
    // Intl is lenient here — it uses the code as the symbol.
    const out = formatCurrency(1234, "ZZZ");
    expect(out).toContain("ZZZ");
    expect(out).toContain("1,234");
  });

  it("never throws on a structurally invalid code (no DB CHECK on deals.currency)", () => {
    for (const bad of ["United States", "US", "USDD", "12", "u$d"]) {
      expect(() => formatCurrency(1234, bad)).not.toThrow();
      expect(formatCurrency(1234, bad)).toContain("1,234");
    }
  });

  it("formats every offered currency without throwing", () => {
    for (const c of CURRENCIES) {
      expect(() => formatCurrency(1000, c.code)).not.toThrow();
    }
  });
});

describe("formatCurrencyShort", () => {
  it("abbreviates millions and thousands with the currency symbol", () => {
    expect(formatCurrencyShort(2_500_000, "USD")).toBe("$2.5M");
    expect(formatCurrencyShort(3_400, "USD")).toBe("$3.4k");
    expect(formatCurrencyShort(900, "USD")).toBe("$900");
  });

  it("uses the matching symbol for non-USD currencies", () => {
    expect(formatCurrencyShort(1_000, "EUR")).toBe("€1.0k");
    expect(formatCurrencyShort(1_000, "INR")).toBe("₹1.0k");
  });

  it("falls back to the code prefix for unknown currencies (no throw)", () => {
    expect(formatCurrencyShort(1_000, "ZZZ")).toBe("ZZZ 1.0k");
  });
});
