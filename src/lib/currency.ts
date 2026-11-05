/**
 * Currency — single source of truth for deal-value formatting and
 * the currency picker options.
 *
 * Before this module, ~6 components each defined their own
 * `Intl.NumberFormat(..., { currency: "USD" })` helper with USD
 * baked in. The default currency is configurable per account
 * (accounts.default_currency, migration 021, CHECK `^[A-Z]{3}$`), so
 * every formatter takes a currency and falls back to DEFAULT_CURRENCY
 * only when nothing is known.
 *
 * The list used to be 15 hard-coded currencies with English labels — which
 * meant a business targeting the Arab world could not pick EGP, SAR, KWD, QAR
 * or any of the other Gulf/Levant/North-Africa currencies (reported
 * 2026-11-05). It is now the ISO-4217 set, named in the app's own language,
 * so Arabic reads «جنيه مصري» rather than «Egyptian Pound».
 */

import { getT } from "@/lib/i18n/translate";

/** App-wide fallback when no account/deal currency is available. */
export const DEFAULT_CURRENCY = "USD";

export interface CurrencyOption {
  /** ISO-4217 code, e.g. "USD". Stored verbatim in the DB. */
  code: string;
  /** Human label for the dropdown, localized to the app locale. */
  label: string;
  /** Symbol for compact display, e.g. "ج.م". */
  symbol: string;
}

function appLocale(): string {
  const env = process.env.NEXT_PUBLIC_APP_LOCALE ?? "";
  return env === "ar" ? "ar" : "en";
}

const t = getT("Currency");

/**
 * Names we ship ourselves (the currencies this product actually meets) so the
 * catalogue reads naturally in both languages even where ICU data is thin.
 * Everything else falls back to `Intl.DisplayNames`.
 */
const KNOWN_LABELS: Record<string, string> = {
  USD: t("USD"),
  EUR: t("EUR"),
  GBP: t("GBP"),
  INR: t("INR"),
  AUD: t("AUD"),
  CAD: t("CAD"),
  BRL: t("BRL"),
  JPY: t("JPY"),
  CNY: t("CNY"),
  AED: t("AED"),
  ZAR: t("ZAR"),
  NGN: t("NGN"),
  SGD: t("SGD"),
  MXN: t("MXN"),
  COP: t("COP"),
  EGP: "Egyptian Pound",
  SAR: "Saudi Riyal",
  KWD: "Kuwaiti Dinar",
  QAR: "Qatari Riyal",
  BHD: "Bahraini Dinar",
  OMR: "Omani Rial",
  JOD: "Jordanian Dinar",
  IQD: "Iraqi Dinar",
  LBP: "Lebanese Pound",
  MAD: "Moroccan Dirham",
  TND: "Tunisian Dinar",
  DZD: "Algerian Dinar",
  LYD: "Libyan Dinar",
  SDG: "Sudanese Pound",
  YER: "Yemeni Rial",
  SYP: "Syrian Pound",
  MRU: "Mauritanian Ouguiya",
};

/** The same codes in Arabic, so the picker reads right in the Arabic UI. */
const KNOWN_LABELS_AR: Record<string, string> = {
  USD: "دولار أمريكي",
  EUR: "يورو",
  GBP: "جنيه إسترليني",
  INR: "روبية هندية",
  AUD: "دولار أسترالي",
  CAD: "دولار كندي",
  BRL: "ريال برازيلي",
  JPY: "ين ياباني",
  CNY: "يوان صيني",
  AED: "درهم إماراتي",
  ZAR: "راند جنوب أفريقي",
  NGN: "نايرا نيجيري",
  SGD: "دولار سنغافوري",
  MXN: "بيزو مكسيكي",
  COP: "بيزو كولومبي",
  EGP: "جنيه مصري",
  SAR: "ريال سعودي",
  KWD: "دينار كويتي",
  QAR: "ريال قطري",
  BHD: "دينار بحريني",
  OMR: "ريال عماني",
  JOD: "دينار أردني",
  IQD: "دينار عراقي",
  LBP: "ليرة لبنانية",
  MAD: "درهم مغربي",
  TND: "دينار تونسي",
  DZD: "دينار جزائري",
  LYD: "دينار ليبي",
  SDG: "جنيه سوداني",
  YER: "ريال يمني",
  SYP: "ليرة سورية",
  MRU: "أوقية موريتانية",
  TRY: "ليرة تركية",
  PKR: "روبية باكستانية",
};

/**
 * The currencies offered in pickers — the active ISO-4217 set.
 *
 * Codes must be valid ISO-4217 so `Intl.NumberFormat` renders the right
 * symbol/grouping. Adding a code here is all a new market needs; the DB
 * accepts any `[A-Z]{3}`.
 */
const CODES = [
  // The Arab world first — the market this deployment serves.
  "EGP", "SAR", "AED", "KWD", "QAR", "BHD", "OMR", "JOD", "IQD", "LBP",
  "MAD", "TND", "DZD", "LYD", "SDG", "YER", "SYP", "MRU", "DJF", "SOS",
  "KMF",
  // Major / reserve
  "USD", "EUR", "GBP", "CHF", "JPY", "CNY", "INR", "TRY", "RUB", "BRL",
  "CAD", "AUD", "NZD", "SGD", "HKD", "KRW", "ZAR", "MXN", "ARS", "CLP",
  "COP", "PEN", "UYU", "BOB", "PYG", "VES", "GTQ", "CRC", "DOP", "PAB",
  // Europe
  "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "HRK", "RSD",
  "UAH", "ISK", "GEL", "AMD", "AZN", "BYN", "MDL", "ALL", "MKD", "BAM",
  // Africa / Central Asia
  "NGN", "GHS", "KES", "TZS", "UGX", "RWF", "ETB", "XOF", "XAF", "ZMW",
  "MWK", "MZN", "BWP", "NAD", "MUR", "SCR", "MGA", "AOA", "CDF", "GMD",
  "GNF", "SLE", "LRD", "SSP", "TMT", "UZS", "KZT", "KGS", "TJS", "MNT",
  // Asia / Pacific
  "PKR", "BDT", "LKR", "NPR", "MMK", "THB", "VND", "IDR", "MYR", "PHP",
  "TWD", "MOP", "BND", "KHR", "LAK", "AFN", "IRR", "MVR", "BTN",
  // Americas
  "TTD", "JMD", "BBD", "BSD", "BZD", "GYD", "SRD", "HTG", "CUP", "NIO",
  "HNL", "SVC", "BMD", "KYD", "XCD", "AWG", "ANG",
  // Oceania
  "FJD", "PGK", "WST", "TOP", "VUV", "SBD", "XPF",
] as const;

/** Arab-world currencies, surfaced as a quick group at the top of the picker. */
export const ARAB_CURRENCIES: readonly string[] = CODES.slice(0, 21);

function ownName(code: string, locale: string): string {
  return locale === "ar"
    ? (KNOWN_LABELS_AR[code] ?? KNOWN_LABELS[code] ?? "")
    : (KNOWN_LABELS[code] ?? "");
}

/** Localized currency name: our own copy first, ICU data second, code last. */
export function currencyName(code: string, locale: string = appLocale()): string {
  const own = ownName(code, locale);
  if (own) return own;
  try {
    const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
    if (name && name !== code) return name;
  } catch {
    // ICU data missing for this locale/runtime — the code is still legible.
  }
  return code;
}

/** Symbol from ICU ("ج.م." / "E£"), falling back to the code itself. */
export function currencySymbol(code: string, locale: string = appLocale()): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    const symbol = parts.find((part) => part.type === "currency")?.value;
    if (symbol) return symbol;
  } catch {
    // fall through
  }
  return `${code} `;
}

export const CURRENCIES: CurrencyOption[] = CODES.map((code) => ({
  code,
  label: currencyName(code),
  symbol: currencySymbol(code),
}));

/** Structural check — the DB enforces the same shape. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

/**
 * Filter the catalogue for the searchable picker.
 *
 * Matches the code, the localized name and the English name, so someone typing
 * «جنيه» and someone typing "pound" both land on EGP/GBP/SYP. An empty query
 * returns the whole catalogue.
 */
export function searchCurrencies(query: string, locale: string = appLocale()): CurrencyOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return CURRENCIES;

  return CURRENCIES.filter((option) => {
    if (option.code.toLowerCase().startsWith(q)) return true;
    if (currencyName(option.code, locale).toLowerCase().includes(q)) return true;
    return currencyName(option.code, "en").toLowerCase().includes(q);
  });
}

/**
 * Format a deal value as a currency string. Whole-number output
 * (no minor units) — deal values are tracked to the dollar across
 * the app. `currency` defaults to USD so callers with nothing better
 * stay safe, but pass the account/deal currency wherever known.
 *
 * Total by design: `Intl.NumberFormat` throws a RangeError on a
 * structurally invalid currency code, and `deals.currency` carries
 * NO DB CHECK (only `accounts.default_currency` does), so legacy
 * rows, imports, or hand-edited data can hold malformed values like
 * "United States". We never let that crash a render — on a bad code
 * we fall back to "CODE 1,234".
 */
export function formatCurrency(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = (currency || DEFAULT_CURRENCY).trim();
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Invalid ISO code — show the raw code + grouped number so the
    // value is still legible instead of throwing.
    return `${code} ${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(amount)}`;
  }
}

/**
 * Compact currency for tight spaces (donut center, legend rows):
 * "$1.2M" / "€34.5k" / "₹900". Uses the currency's symbol from
 * CURRENCIES, falling back to the code when we don't carry a symbol.
 */
export function formatCurrencyShort(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = currency || DEFAULT_CURRENCY;
  const symbol = CURRENCIES.find((c) => c.code === code)?.symbol ?? `${code} `;
  return `${symbol}${formatCompactNumber(value)}`;
}

/**
 * Compact number for tight spaces (chart tiles, legends): 1_234 → "1.2k",
 * 1_200_000 → "1.2M", 900 → "900". The unit-less core shared with
 * {@link formatCurrencyShort}.
 */
export function formatCompactNumber(value: number): string {
  const v = Number(value || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}
