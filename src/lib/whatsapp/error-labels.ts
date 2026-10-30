/**
 * Meta Cloud API delivery errors → a slug the UI can translate.
 *
 * The webhook stores Meta's English `error_title` ("Re-engagement message",
 * "Undeliverable", …). That is accurate and useless to a clinic's staff: it
 * names the wire format, not the situation or the fix. Every surface that
 * shows a failed send (dashboard "failed messages" dialog, the bubble
 * tooltip) resolves the code here and renders `WhatsAppErrors.<slug>.title`
 * + `.hint` from the message catalogues.
 *
 * Pure and I/O-free so it can be unit-tested without a DB or a translator.
 * The keyword fallback matters: older rows carry an `error_title` with no
 * `error_code`, and Meta occasionally ships a code we have not catalogued.
 */

export type WhatsAppErrorSlug =
  | 'reengagement'
  | 'undeliverable'
  | 'templateParams'
  | 'templateMissing'
  | 'templatePaused'
  | 'templateDisabled'
  | 'templatePolicy'
  | 'mediaUpload'
  | 'rateLimited'
  | 'pairRateLimited'
  | 'billing'
  | 'phoneUnregistered'
  | 'unsupportedType'
  | 'tokenExpired'
  | 'invalidParam'
  | 'accountLocked';

const BY_CODE: Record<number, WhatsAppErrorSlug> = {
  // 131047: outside the 24-hour customer-service window.
  131047: 'reengagement',
  // 131026: recipient cannot receive (not on WhatsApp / no opt-in / blocked us).
  131026: 'undeliverable',
  // Template shape and lifecycle.
  132000: 'templateParams',
  132001: 'templateMissing',
  132012: 'templateParams',
  132015: 'templatePaused',
  132016: 'templateDisabled',
  132007: 'templatePolicy',
  // Media.
  131053: 'mediaUpload',
  // Throughput.
  130429: 'rateLimited',
  131056: 'pairRateLimited',
  // Account state.
  131042: 'billing',
  133010: 'phoneUnregistered',
  131051: 'unsupportedType',
  131031: 'accountLocked',
  190: 'tokenExpired',
  100: 'invalidParam',
};

interface Rule {
  slug: WhatsAppErrorSlug;
  test: RegExp;
}

/** Ordered: the first match wins, so specific phrases come before generic. */
const BY_TEXT: Rule[] = [
  { slug: 'reengagement', test: /re-?engagement|24\s*hour|outside .*window/i },
  { slug: 'undeliverable', test: /undeliverable|not (?:on|using) whatsapp|no opt-?in/i },
  { slug: 'templatePaused', test: /template .*(?:paused|disabled for|low quality)/i },
  { slug: 'templateDisabled', test: /template .*(?:disabled|deleted|does not exist)/i },
  { slug: 'templatePolicy', test: /policy violation|content .*violat/i },
  { slug: 'templateParams', test: /number of (?:localizable )?parameters|parameter.*(?:mismatch|format)/i },
  { slug: 'templateMissing', test: /template .*(?:not found|not approved)/i },
  { slug: 'mediaUpload', test: /media (?:upload|download)|unsupported media/i },
  { slug: 'pairRateLimited', test: /pair rate limit|too many messages to (?:this|the same) (?:user|recipient)/i },
  { slug: 'rateLimited', test: /rate limit|too many requests/i },
  { slug: 'billing', test: /payment|billing|credit line/i },
  { slug: 'phoneUnregistered', test: /not registered|register(?:ed)? the phone/i },
  { slug: 'tokenExpired', test: /access token.*(?:expired|invalid)|session has expired/i },
  { slug: 'accountLocked', test: /account .*(?:locked|restricted|blocked)/i },
  { slug: 'invalidParam', test: /invalid parameter/i },
];

/**
 * Resolve Meta's numeric code first (authoritative), then fall back to the
 * English title/details text, then give up (`null` → the UI shows Meta's
 * raw reason, which is still better than a wrong explanation).
 */
export function errorSlug(
  code?: number | string | null,
  ...text: (string | null | undefined)[]
): WhatsAppErrorSlug | null {
  const numeric = typeof code === 'string' ? Number(code) : code;
  if (typeof numeric === 'number' && Number.isFinite(numeric)) {
    const hit = BY_CODE[numeric];
    if (hit) return hit;
  }

  const haystack = text.filter(Boolean).join(' ');
  if (!haystack) return null;
  for (const rule of BY_TEXT) {
    if (rule.test.test(haystack)) return rule.slug;
  }
  return null;
}

/** True when we have copy for this code, without resolving it twice. */
export function hasLabel(slug: string | null): slug is WhatsAppErrorSlug {
  return slug !== null;
}
