/**
 * Append-only audit trail for privileged actions.
 *
 * Every mutation in `/api/admin/*` calls this before returning. A
 * failure to write the log is reported but never rolls back the
 * action: losing an audit row is bad, silently pretending a mutation
 * did not happen is worse.
 */

import { adminDb } from './db';
import type { PlatformAdmin } from './auth';

export interface AuditInput {
  actor: PlatformAdmin;
  /** Machine-readable verb, e.g. `account.status.changed`. */
  action: string;
  targetType?:
    | 'account'
    | 'user'
    | 'invoice'
    | 'channel'
    | 'plan'
    | 'settings'
    | 'admin'
    | 'signup'
    | 'inquiry';
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown>;
}

export async function logAdminAction(input: AuditInput): Promise<void> {
  const { error } = await adminDb()
    .from('admin_audit_log')
    .insert({
      actor_user_id: input.actor.userId,
      actor_email: input.actor.email,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      details: input.details ?? {},
    });

  if (error) {
    console.error('[admin] audit write failed:', error.message, input.action);
  }
}
