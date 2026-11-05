/**
 * How a `?c=<id>` inbox deep link resolves.
 *
 * The list holds one page of `CONVERSATION_PAGE_SIZE` rows, so the linked
 * thread is frequently NOT among the rows we just fetched: a link is pasted
 * long after the list was loaded, and every inbound message reshuffles the
 * order. Matching only inside the loaded page silently did nothing for those
 * links — the center panel kept showing «اختر محادثة من القائمة» for a thread
 * that exists (reported 2026-11-05: the target sat at rank 27 of 1551).
 *
 * `"loaded"` — the row is already in hand, select it.
 * `"database"` — the row must be fetched by id, or the link dead-ends.
 */
export type DeepLinkTarget = "loaded" | "database";

export function deepLinkTarget(
  convId: string,
  loadedIds: readonly string[],
): DeepLinkTarget {
  return loadedIds.includes(convId) ? "loaded" : "database";
}
