/**
 * What a Settings → Agent → Setup save is allowed to write into
 * `ai_configs.agent_name` (migration 106).
 *
 * The column is optional free text and the API distinguishes three shapes:
 * an ABSENT key leaves the stored name alone, an empty string clears it back to
 * "sign with the account name", and text sets it. The form can only tell them
 * apart if it knows whether a human touched the box — the same trap that wiped
 * `handoff_message` — so an untouched field must stay absent rather than post
 * `null` over a name the tenant already saved.
 */

/** Longest name the column accepts (`ai_configs_agent_name_length`). */
export const AGENT_NAME_MAX_LENGTH = 60;

export function agentNamePayload(
  value: string,
  edited: boolean,
): string | null | undefined {
  if (!edited) return undefined;
  const trimmed = value.trim().slice(0, AGENT_NAME_MAX_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}
