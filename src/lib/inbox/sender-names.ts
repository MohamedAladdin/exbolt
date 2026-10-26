/**
 * Who sent this message?
 *
 * Outbound messages carry `sender_id` (the auth user who hit send — see
 * `src/lib/whatsapp/send-message.ts`), but `messages` has no foreign key to
 * `profiles`, so PostgREST cannot embed the sender. We resolve the ids in one
 * extra round-trip per thread and cache them on the client.
 *
 * Deliberately not a store/migration: the caption is a read-only affordance
 * for supervisors ("who replied to this customer?"), and a join table would
 * only duplicate data the profile already owns.
 */

export type SenderProfileRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

/** The name we show under an outgoing bubble. */
export function senderDisplayName(row: SenderProfileRow): string | null {
  const name = (row.full_name ?? "").trim();
  if (name) return name;
  const email = (row.email ?? "").trim();
  if (email.includes("@")) {
    const local = email.split("@")[0]?.trim();
    if (local) return local;
  }
  return email || null;
}

/**
 * Ids worth resolving: agent-authored messages that we have no name for yet.
 * Customer and bot messages have no human sender, and unknown ids already in
 * the cache are skipped so the effect cannot loop.
 */
export function unresolvedSenderIds(
  messages: { sender_id?: string | null; sender_type?: string | null }[],
  known: Map<string, string>,
  failed: Set<string> = new Set(),
): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    const id = message.sender_id;
    if (!id) continue;
    if (message.sender_type !== "agent") continue;
    if (known.has(id) || failed.has(id)) continue;
    ids.add(id);
  }
  return [...ids];
}
