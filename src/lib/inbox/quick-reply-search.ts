/**
 * Slash-triggered quick-reply search.
 *
 * Typing `/` in the composer opens the quick-reply list and everything
 * typed after it filters it live (`/اهلا` → every quick reply whose title
 * or body mentions that word). Kept out of the component so the matching
 * rules — the part that decides what an agent sees — are testable without
 * a DOM.
 */

import type { QuickReply } from "@/types";

/** Arabic diacritics (tashkeel), Quranic marks and the tatweel. */
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/**
 * Fold a string for human-friendly matching:
 *  - lowercase (Latin),
 *  - strip Arabic diacritics and tatweel,
 *  - unify alef/ya/ta-marbuta variants so "احمد" matches "أحمد" and
 *    "مصطفي" matches "مصطفى",
 *  - collapse whitespace.
 */
export function normalizeForSearch(input: string): string {
  return input
    .normalize("NFKD")
    .replace(ARABIC_MARKS, "")
    .replace(/[\u0622\u0623\u0625]/g, "\u0627") // آ أ إ → ا
    .replace(/\u0649/g, "\u064A") // ى → ي
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The `/query` token the caret sits in, or null when there is none.
 *
 * Only a `/` at the start of the text or right after whitespace counts —
 * a slash inside a URL (`https://…`) must not open the picker.
 */
export function slashQueryAt(
  text: string,
  caret: number,
): { start: number; end: number; query: string } | null {
  const upto = text.slice(0, caret);
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(upto);
  if (!match) return null;
  const query = match[1];
  const start = upto.length - query.length - 1;
  return { start, end: caret, query };
}

/**
 * Quick replies matching `query` in title or body, best match first.
 *
 * Ranking: title-prefix beats title-contains beats body-contains, so
 * "/اهلا" surfaces "أهلاً بك" above a snippet that merely mentions it
 * mid-sentence. An empty query returns everything (the picker doubles as
 * a browse list).
 */
export function filterQuickReplies(
  items: QuickReply[],
  query: string,
): QuickReply[] {
  const q = normalizeForSearch(query);
  if (!q) return items;

  const scored: { item: QuickReply; score: number }[] = [];
  for (const item of items) {
    const title = normalizeForSearch(item.title ?? "");
    const body = normalizeForSearch(item.content_text ?? "");
    let score = -1;
    if (title.startsWith(q)) score = 0;
    else if (title.includes(q)) score = 1;
    else if (body.includes(q)) score = 2;
    if (score >= 0) scored.push({ item, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
    .map((entry) => entry.item);
}
