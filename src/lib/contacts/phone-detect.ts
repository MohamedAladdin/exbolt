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

/** Longest a phone number can be, per E.164. */
const MAX_DIGITS = 15;
/** Shortest run we accept without an explicit country prefix. */
const MIN_DIGITS = 9;

/**
 * Digits as people actually type them: Latin, Arabic-Indic (٠-٩) and
 * Persian (۰-۹). The mapping is 1:1, so offsets stay valid in the source.
 */
const DIGIT_CHARS = "\\d\\u0660-\\u0669\\u06f0-\\u06f9";
/** Invisible bidi marks WhatsApp sprinkles into Arabic chats. */
const BIDI_CHARS = "\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069";

/**
 * One stretch of text that may hold one or more numbers. Separators are
 * allowed inside a number (`+20 101 234 5678`), so a run can also swallow a
 * whole list of numbers — that is why it is cut up again below.
 */
const CANDIDATE = new RegExp(
  `(?<![\\w+])(?:\\+|00)?[${DIGIT_CHARS}][${DIGIT_CHARS}\\s().\\-${BIDI_CHARS}]{3,24}[${DIGIT_CHARS}](?![\\w])`,
  "g",
);
const DIGIT_RUN = new RegExp(`[${DIGIT_CHARS}]+`, "g");
const SEPARATOR_ONLY = new RegExp(`^[\\s().\\-${BIDI_CHARS}]+$`);

/** Rewrite Arabic-Indic/Persian digits as Latin ones, same length. */
export function toLatinDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function digitsOf(text: string): string {
  return toLatinDigits(text).replace(/\D/g, "");
}

interface RunSlice {
  /** Offset of the slice inside the run. */
  start: number;
  end: number;
}

/**
 * Cut one matched run into individual numbers.
 *
 * `"01012345678 01098765432"` arrives as a single 22-digit blob because the
 * separators are legal inside a number. Reading it as one candidate breaks the
 * E.164 ceiling and throws the whole line away — the reported symptom was "the
 * popup does not come up on any number in a message that has a group of
 * numbers". So the run is segmented into the largest number of pieces that
 * each hold MIN_DIGITS…MAX_DIGITS digits: ambiguity resolves towards more
 * numbers, since a number nobody can click is the failure we care about.
 */
function splitRun(run: string): RunSlice[] {
  const blocks: { start: number; end: number; length: number }[] = [];
  for (const match of run.matchAll(DIGIT_RUN)) {
    const start = match.index ?? 0;
    blocks.push({ start, end: start + match[0].length, length: match[0].length });
  }
  if (blocks.length === 0) return [];

  // A leading `+`/`00` belongs to the first number and must stay inside its
  // slice — `deriveE164` reads the country code from it.
  const prefix = /^(?:\+|00)/.exec(run)?.[0].length ?? 0;
  const keepPrefix = (slice: RunSlice, index: number): RunSlice =>
    index === 0 && prefix > 0 && slice.start > 0 ? { start: 0, end: slice.end } : slice;

  if (blocks.length === 1) {
    return [{ start: blocks[0].start, end: blocks[0].end }].map(keepPrefix);
  }

  const joinedBySeparator = (index: number) =>
    SEPARATOR_ONLY.test(run.slice(blocks[index].end, blocks[index + 1].start));

  // best[i] = segmentation of blocks i…n-1 with the most valid pieces.
  const best: (RunSlice[] | null)[] = new Array(blocks.length + 1).fill(null);
  best[blocks.length] = [];
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    let digits = 0;
    let chosen: RunSlice[] | null = null;
    for (let j = i; j < blocks.length; j += 1) {
      if (j > i && !joinedBySeparator(j - 1)) break;
      digits += blocks[j].length;
      if (digits > MAX_DIGITS) break;
      const rest = best[j + 1];
      if (digits < MIN_DIGITS || !rest) continue;
      const candidate = [
        { start: blocks[i].start, end: blocks[j].end },
        ...rest,
      ];
      if (!chosen || candidate.length > chosen.length) chosen = candidate;
    }
    best[i] = chosen;
  }

  if (!best[0]) {
    // Nothing is long enough on its own — hand back the raw blocks so the
    // per-candidate rules can still accept an explicit `+`/`00` short number.
    return blocks
      .map((block) => ({ start: block.start, end: block.end }))
      .map(keepPrefix);
  }

  return best[0].map(keepPrefix);
}

/** Inside a URL, a query string or an attribute — an id, not a phone. */
function sitsInUrlContext(text: string, start: number): boolean {
  if (start === 0) return false;
  const before = text[start - 1];
  if (/[/=?&#%]/.test(before)) return true;
  // `tel:0101…` is a phone; `https://…/0101…` is a path.
  if (before === ":") return /\/$/.test(text.slice(Math.max(0, start - 4), start - 1));
  return false;
}

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
    const runText = match[0];
    const runStart = match.index ?? 0;

    // A run can hold a whole list of numbers; keep every one of them.
    for (const slice of splitRun(runText)) {
      const raw = runText.slice(slice.start, slice.end);
      const start = runStart + slice.start;
      const digits = digitsOf(raw);

      // Part of a URL / path / query — "…/track/1234567890" is an id, not a
      // number anyone can call.
      if (sitsInUrlContext(text, start)) continue;

      if (digits.length < MIN_DIGITS && !(raw.trim().startsWith("+") && digits.length >= 8)) {
        continue;
      }
      if (digits.length > MAX_DIGITS) continue;
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
