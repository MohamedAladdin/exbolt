/**
 * White-label branding (migration 062).
 *
 * The product is sold as EXCAL's, but each client sees their own system
 * name: an admin types it once in Settings → Branding and it shows up in
 * the sidebar and the browser title, with the vendor credit appended —
 * "نظام التواصل من ExCal.uk" in Arabic, "نظام التواصل by ExCal.uk" in
 * English. `accounts.brand_name` is NULL until they set one, in which case
 * everything falls back to the built-in product name.
 */

export const PRODUCT_NAME = "wacrm";
export const VENDOR_NAME = "ExCal.uk";
export const VENDOR_URL = "https://excal.uk";

/** Arabic gets the natural "من" construction; everything else "by". */
export function vendorSuffix(locale: string): string {
  return locale === "ar" ? `من ${VENDOR_NAME}` : `by ${VENDOR_NAME}`;
}

/** The system name alone (sidebar label, settings preview). */
export function brandName(brand: string | null | undefined): string {
  const trimmed = brand?.trim();
  return trimmed ? trimmed : PRODUCT_NAME;
}

/**
 * Full title: "<brand> <suffix>". Returns just the product name when the
 * account has not branded itself — a fresh install should not advertise a
 * placeholder brand.
 */
export function composeBrandTitle(
  brand: string | null | undefined,
  locale: string,
): string {
  const trimmed = brand?.trim();
  if (!trimmed) return PRODUCT_NAME;
  return `${trimmed} ${vendorSuffix(locale)}`;
}
