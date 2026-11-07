/**
 * When may the assistant speak on a thread?
 *
 * `conversations.ai_autoreply_disabled` is the sticky "the bot is off
 * here" flag. A handoff sets it together with `ai_paused_until`, so the
 * pause is bounded: once the window elapses with no agent assigned, the
 * next inbound resumes the assistant instead of being ignored.
 *
 * Three states:
 *  - `active`  — the bot may reply.
 *  - `paused`  — a human paused it (no deadline) or the window is still open.
 *  - `expired` — a handoff window ended with nobody taking over; clear the
 *                flag and reply.
 */
export type AiPauseState = 'active' | 'paused' | 'expired'

export function aiPauseState(
  disabled: boolean | null | undefined,
  pausedUntil: string | null | undefined,
  now: number = Date.now(),
): AiPauseState {
  if (!disabled) return 'active'
  if (!pausedUntil) return 'paused'
  const until = new Date(pausedUntil).getTime()
  if (!Number.isFinite(until)) return 'paused'
  return until > now ? 'paused' : 'expired'
}
