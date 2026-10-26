/**
 * Phone-number detection inside message text.
 *
 * The inbox makes every phone number in a conversation actionable (open
 * the contact card, jump straight into a chat), so the detector has to be
 * conservative: a false positive turns an order id or a date into a
 * clickable "call this person" affordance, which is worse than missing an
 * oddly-formatted number.
 *
 * Rules, in order:
 *  - a candidate must be a run of digits with at most common separators
 *    (space, dash, dot, parentheses) and must not touch a word character
 *    on either side;
 *  - 9+ digits, or 8+ when explicitly international (`+`), which is the
 *    floor most real numbering plans satisfy;
 *  - date-like strings (`2026-10-26`, `26.10.2026`), money-ish runs with
 *    a single separator group, and repeated-digit runs are rejected.
 *
 * Pure + exported for tests; the React side lives in
 * `components/inbox/linked-text.tsx`.
 */

export interface PhoneCandidate {
  /** Start offset in the source text. */
  start: number;
  /** End offset (exclusive). */
  end: number;
  /** Exactly what the message contained, separators included. */
  raw: string;
  /** Digits only, as Meta wants them. */
  digits: string;
  /**
   * `+<country code><national number>` when the raw form tells us the
   * country; null when it is ambiguous (a bare local number with no
   * derivable country code). Null candidates are still shown — the peek
   * can do a loose digits match — but cannot start a chat.
   */
  e164: string | null;
}

/** Country code used to promote a local trunk-0 number to E.164. */
export function defaultCountryCode(): string {
  const env = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE?.replace(/\D/g, "");
  return env && env.length >= 1 && env.length <= 3 ? env : "20";
}

const CANDIDATE = /(?<![\w+])(?:\+|00)?\d[\d\s().-]{3,24}\d(?![\w])/g;

/** `2026-10-26`, `26.10.2026`, `26/10` — a date, not a phone. */
function looksLikeDate(raw: string): boolean {
  return /^\d{4}[-.]\d{1,2}[-.]\d{1,2}$/.test(raw) || /^\d{1,2}[-.]\d{1,2}[-.]\d{2,4}$/.test(raw);
}

function deriveE164(digits: string, raw: string): string | null {
  const trimmed = raw.trim();

  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (trimmed.startsWith("00")) {
    const rest = digits.replace(/^00/, "");
    return rest.length >= 8 && rest.length <= 15 ? `+${rest}` : null;
  }
  // Local trunk form, e.g. Egypt's 01012345678 → +201012345678.
  if (/^0\d{9,10}$/.test(digits)) {
    const cc = defaultCountryCode();
    const international = `${cc}${digits.slice(1)}`;
    return international.length >= 9 && international.length <= 15
      ? `+${international}`
      : null;
  }
  return null;
}

export function findPhoneMatches(text: string): PhoneCandidate[] {
  if (!text) return [];

  const out: PhoneCandidate[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const digits = raw.replace(/\D/g, "");

    // Part of a URL / path / query — "…/track/1234567890" is an id, not a
    // number anyone can call.
    const before = start > 0 ? text[start - 1] : "";
    if (/[/:=?&#%]/.test(before)) continue;

    if (digits.length < 9 && !(raw.trim().startsWith("+") && digits.length >= 8)) {
      continue;
    }
    if (digits.length > 15) continue;
    if (looksLikeDate(raw.trim())) continue;
    // "111111111" / "0000000000" are placeholders, not phone numbers.
    if (new Set(digits).size <= 2) continue;

    out.push({
      start,
      end: start + raw.length,
      raw,
      digits,
      e164: deriveE164(digits, raw),
    });
  }
  return out;
}

/** Split text into plain and phone segments for rendering. */
export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "phone"; candidate: PhoneCandidate; text: string };

export function segmentByPhone(text: string): TextSegment[] {
  if (!text) return [];
  const matches = findPhoneMatches(text);
  if (matches.length === 0) return [{ kind: "text", text }];

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const candidate of matches) {
    if (candidate.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, candidate.start) });
    }
    segments.push({
      kind: "phone",
      candidate,
      text: text.slice(candidate.start, candidate.end),
    });
    cursor = candidate.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}
