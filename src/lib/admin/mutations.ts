/**
 * Mutations for the super-admin panel.
 *
 * Every function here (a) validates its input, (b) writes through the
 * service role, (c) records an audit row, and (d) returns the updated
 * row so the route can hand it straight back to the UI. Routes stay thin.
 */

import { adminDb } from './db';
import { logAdminAction } from './audit';
import type { PlatformAdmin } from './auth';
import {
  invoiceTotals,
  randomInvoiceNumber,
  toMoney,
  type LineItem,
} from './invoice';
import { renderInvoiceEmail, renderReminderEmail, sendEmail } from './email';
import {
  getSettings,
  listInvoiceNumbers,
  listInvoices,
  type InvoiceRow,
} from './queries';
import { planReminder } from './reminders';

const ACCOUNT_STATUSES = ['active', 'suspended', 'archived', 'banned'] as const;
const SUB_STATUSES = [
  'trial',
  'active',
  'past_due',
  'canceled',
  'suspended',
] as const;
const GRANT_KINDS = [
  'feature',
  'limit',
  'plan_upgrade',
  'trial_extension',
  'discount',
  'credit',
] as const;

export type AccountStatusValue = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatusValue {
  return (
    typeof value === 'string' &&
    (ACCOUNT_STATUSES as readonly string[]).includes(value)
  );
}

// ------------------------------------------------------------
// Tenant lifecycle
// ------------------------------------------------------------

export async function setAccountStatus(params: {
  actor: PlatformAdmin;
  accountId: string;
  status: AccountStatusValue;
  reason?: string | null;
}) {
  const { actor, accountId, status } = params;
  const reason = params.reason?.trim() || null;

  const { data: before } = await adminDb()
    .from('accounts')
    .select('name, status')
    .eq('id', accountId)
    .maybeSingle();
  if (!before) throw new Error('invalid_account_not_found');

  const { error } = await adminDb()
    .from('accounts')
    .update({
      status,
      status_reason: reason,
      status_changed_at: new Date().toISOString(),
    })
    .eq('id', accountId);
  if (error) throw new Error(`admin_status_update_failed: ${error.message}`);

  await logAdminAction({
    actor,
    action: 'account.status.changed',
    targetType: 'account',
    targetId: accountId,
    targetLabel: before.name as string,
    details: { from: before.status, to: status, reason },
  });

  return { status, reason };
}

export async function setDocumentNotes(params: {
  actor: PlatformAdmin;
  accountId: string;
  notes: string | null;
}) {
  const { actor, accountId } = params;
  const notes = params.notes?.trim() || null;

  // `account_subscriptions.notes` is the operator's memo about the deal.
  // No row yet → create a trial row so the memo has somewhere to live.
  const db = adminDb();
  const { data: existing } = await db
    .from('account_subscriptions')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from('account_subscriptions')
      .update({ notes })
      .eq('account_id', accountId);
    if (error) throw new Error(`admin_notes_update_failed: ${error.message}`);
  } else {
    const { error } = await db
      .from('account_subscriptions')
      .insert({ account_id: accountId, status: 'trial', notes });
    if (error) throw new Error(`admin_notes_insert_failed: ${error.message}`);
  }

  await logAdminAction({
    actor,
    action: 'account.notes.updated',
    targetType: 'account',
    targetId: accountId,
    details: { notes },
  });
  return { notes };
}

// ------------------------------------------------------------
// Subscription
// ------------------------------------------------------------

export async function setSubscription(params: {
  actor: PlatformAdmin;
  accountId: string;
  planCode: string | null;
  status?: (typeof SUB_STATUSES)[number];
  billingInterval?: 'monthly' | 'annual';
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  featureOverrides?: Record<string, boolean>;
  limitOverrides?: Record<string, number | null>;
}) {
  const { actor, accountId, planCode } = params;
  const db = adminDb();

  const { data: account } = await db
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) throw new Error('invalid_account_not_found');

  if (planCode === null) {
    const { error } = await db
      .from('account_subscriptions')
      .delete()
      .eq('account_id', accountId);
    if (error) throw new Error(`admin_plan_clear_failed: ${error.message}`);
    await logAdminAction({
      actor,
      action: 'account.plan.cleared',
      targetType: 'account',
      targetId: accountId,
      targetLabel: account.name as string,
    });
    return { planCode: null };
  }

  const { data: plan } = await db
    .from('plans')
    .select('id, code')
    .eq('code', planCode)
    .maybeSingle();
  if (!plan) throw new Error('invalid_plan_not_found');

  const status = params.status ?? 'active';
  if (!(SUB_STATUSES as readonly string[]).includes(status))
    throw new Error('invalid_subscription_status');

  const payload = {
    account_id: accountId,
    plan_id: plan.id as string,
    status,
    billing_interval: params.billingInterval ?? 'monthly',
    current_period_end: params.currentPeriodEnd ?? null,
    trial_ends_at: params.trialEndsAt ?? null,
    feature_overrides: params.featureOverrides ?? {},
    limit_overrides: params.limitOverrides ?? {},
  };

  const { data: existing } = await db
    .from('account_subscriptions')
    .select('id, status, plan_id')
    .eq('account_id', accountId)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from('account_subscriptions')
      .update(payload)
      .eq('account_id', accountId);
    if (error) throw new Error(`admin_plan_update_failed: ${error.message}`);
  } else {
    const { error } = await db.from('account_subscriptions').insert(payload);
    if (error) throw new Error(`admin_plan_insert_failed: ${error.message}`);
  }

  await logAdminAction({
    actor,
    action: 'account.plan.changed',
    targetType: 'account',
    targetId: accountId,
    targetLabel: account.name as string,
    details: {
      plan: planCode,
      status,
      interval: payload.billing_interval,
      from_plan_id: existing?.plan_id ?? null,
    },
  });

  return { planCode, status };
}

// ------------------------------------------------------------
// Grants & gifts
// ------------------------------------------------------------

export async function createGrant(params: {
  actor: PlatformAdmin;
  accountId: string;
  kind: (typeof GRANT_KINDS)[number];
  key?: string | null;
  value?: unknown;
  reason?: string | null;
  expiresAt?: string | null;
}) {
  const { actor, accountId, kind } = params;
  if (!(GRANT_KINDS as readonly string[]).includes(kind))
    throw new Error('invalid_grant_kind');

  const needsKey = kind === 'feature' || kind === 'limit';
  const key = params.key?.trim() || null;
  if (needsKey && !key) throw new Error('invalid_grant_key_required');

  let value: unknown = params.value ?? (kind === 'feature' ? true : null);
  if (kind === 'feature' && typeof value !== 'boolean')
    throw new Error('invalid_grant_value');
  if (kind === 'limit') {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0)
      throw new Error('invalid_grant_value');
    value = numeric;
  }
  if (kind === 'trial_extension') {
    const months = Number((value as { months?: unknown })?.months ?? 1);
    if (!Number.isFinite(months) || months <= 0 || months > 24)
      throw new Error('invalid_grant_value');
    value = { months };
  }
  if (kind === 'discount') {
    const percent = Number((value as { percent?: unknown })?.percent ?? 0);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100)
      throw new Error('invalid_grant_value');
    value = { percent };
  }
  if (kind === 'credit') {
    const amount = toMoney((value as { amount?: unknown })?.amount ?? 0);
    if (amount <= 0) throw new Error('invalid_grant_value');
    value = {
      amount,
      currency: (value as { currency?: string })?.currency ?? 'USD',
    };
  }

  const { data: account } = await adminDb()
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) throw new Error('invalid_account_not_found');

  const { data, error } = await adminDb()
    .from('account_grants')
    .insert({
      account_id: accountId,
      kind,
      key,
      value,
      reason: params.reason?.trim() || null,
      expires_at: params.expiresAt ?? null,
      granted_by: actor.userId,
      granted_by_email: actor.email,
    })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`admin_grant_insert_failed: ${error.message}`);

  await logAdminAction({
    actor,
    action: 'account.grant.created',
    targetType: 'account',
    targetId: accountId,
    targetLabel: account.name as string,
    details: { kind, key, value, expires_at: params.expiresAt ?? null },
  });

  return { id: (data?.id as string | undefined) ?? null };
}

export async function revokeGrant(params: {
  actor: PlatformAdmin;
  accountId: string;
  grantId: string;
}) {
  const { actor, accountId, grantId } = params;
  const { error } = await adminDb()
    .from('account_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', grantId)
    .eq('account_id', accountId);
  if (error) throw new Error(`admin_grant_revoke_failed: ${error.message}`);

  await logAdminAction({
    actor,
    action: 'account.grant.revoked',
    targetType: 'account',
    targetId: accountId,
    details: { grant_id: grantId },
  });
  return { ok: true };
}

// ------------------------------------------------------------
// Members
// ------------------------------------------------------------

export async function setMemberBlock(params: {
  actor: PlatformAdmin;
  accountId: string;
  userId: string;
  blocked: boolean;
  reason?: string | null;
}) {
  const { actor, accountId, userId, blocked } = params;
  const { data: profile } = await adminDb()
    .from('profiles')
    .select('email, full_name, account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile) throw new Error('invalid_user_not_found');
  if (profile.account_id !== accountId)
    throw new Error('invalid_user_not_in_account');

  const { error } = await adminDb()
    .from('profiles')
    .update({
      blocked_at: blocked ? new Date().toISOString() : null,
      blocked_reason: blocked ? params.reason?.trim() || null : null,
    })
    .eq('user_id', userId);
  if (error) throw new Error(`admin_member_block_failed: ${error.message}`);

  // Block at the auth layer too, so a live session cannot keep going:
  // Supabase's `ban_duration` invalidates refresh tokens for that user.
  try {
    await adminDb().auth.admin.updateUserById(userId, {
      ban_duration: blocked ? '876000h' : 'none',
    });
  } catch (err) {
    console.error('[admin] auth ban update failed:', err);
  }

  await logAdminAction({
    actor,
    action: blocked ? 'user.blocked' : 'user.unblocked',
    targetType: 'user',
    targetId: userId,
    targetLabel: (profile.email as string) ?? null,
    details: { account_id: accountId, reason: params.reason ?? null },
  });

  return { blocked };
}

// ------------------------------------------------------------
// Invoices
// ------------------------------------------------------------

export async function createInvoice(params: {
  actor: PlatformAdmin;
  accountId: string;
  lineItems: LineItem[];
  tax?: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  planCode?: string | null;
  notes?: string | null;
  toEmail?: string | null;
  toName?: string | null;
  numberPrefix?: string;
}) {
  const { actor, accountId } = params;
  if (!Array.isArray(params.lineItems) || params.lineItems.length === 0) {
    throw new Error('invalid_line_items');
  }

  const items: LineItem[] = params.lineItems.map((item) => ({
    description: String(item.description ?? '').slice(0, 200),
    quantity: Number(item.quantity) || 0,
    unit_price: toMoney(item.unit_price),
  }));

  const { data: account } = await adminDb()
    .from('accounts')
    .select('name, brand_name, status')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) throw new Error('invalid_account_not_found');

  const totals = invoiceTotals(items, params.tax ?? 0);
  const issueDate = params.issueDate || new Date().toISOString().slice(0, 10);
  const dueDate =
    params.dueDate ||
    new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const year = Number(issueDate.slice(0, 4));
  const prefix = params.numberPrefix || process.env.INVOICE_PREFIX || 'EXB';

  // Random, not sequential: an invoice number must not advertise how many
  // customers the business has. Collisions are ~1 in 729M per year and the
  // unique index catches them; the insert below retries with a fresh code.
  const issued = new Set(await listInvoiceNumbers());
  let number = randomInvoiceNumber(prefix, year);
  for (let attempt = 0; attempt < 5 && issued.has(number); attempt += 1) {
    number = randomInvoiceNumber(prefix, year);
  }

  const payload = {
    number,
    account_id: accountId,
    status: 'draft' as const,
    currency: params.currency || 'USD',
    amount: totals.total,
    tax: totals.tax,
    issue_date: issueDate,
    due_date: dueDate,
    period_start: params.periodStart ?? null,
    period_end: params.periodEnd ?? null,
    plan_code: params.planCode ?? null,
    line_items: items,
    notes: params.notes ?? null,
    to_email: params.toEmail ?? null,
    to_name:
      params.toName ??
      ((account.brand_name as string) || (account.name as string)),
    created_by: actor.userId,
  };

  let { data, error } = await adminDb()
    .from('invoices')
    .insert(payload)
    .select('*')
    .maybeSingle();
  if (error?.code === '23505') {
    // Number collided with a concurrent create; retry once with a fresh code.
    const retryNumber = randomInvoiceNumber(prefix, year);
    ({ data, error } = await adminDb()
      .from('invoices')
      .insert({ ...payload, number: retryNumber })
      .select('*')
      .maybeSingle());
  }
  if (error) throw new Error(`admin_invoice_insert_failed: ${error.message}`);

  await logAdminAction({
    actor,
    action: 'invoice.created',
    targetType: 'invoice',
    targetId: (data?.id as string | undefined) ?? null,
    targetLabel: `${number} · ${account.name}`,
    details: {
      amount: totals.total,
      currency: payload.currency,
      account_id: accountId,
    },
  });

  return data as Record<string, unknown>;
}

async function loadInvoice(invoiceId: string): Promise<InvoiceRow | null> {
  const { data } = await adminDb()
    .from('invoices')
    .select('*, account:accounts(name, status)')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const account = (row.account ?? {}) as Record<string, unknown>;
  return {
    id: row.id as string,
    number: row.number as string,
    accountId: row.account_id as string,
    accountName: (account.name as string) ?? undefined,
    status: row.status as InvoiceRow['status'],
    currency: (row.currency as string) ?? 'USD',
    amount: toMoney(row.amount),
    tax: toMoney(row.tax),
    issueDate: row.issue_date as string,
    dueDate: row.due_date as string,
    periodStart: (row.period_start as string | null) ?? null,
    periodEnd: (row.period_end as string | null) ?? null,
    planCode: (row.plan_code as string | null) ?? null,
    lineItems: (row.line_items as InvoiceRow['lineItems']) ?? [],
    notes: (row.notes as string | null) ?? null,
    toEmail: (row.to_email as string | null) ?? null,
    toName: (row.to_name as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    paidAt: (row.paid_at as string | null) ?? null,
    lastReminderAt: (row.last_reminder_at as string | null) ?? null,
    remindersSent: Number(row.reminders_sent ?? 0),
    createdAt: row.created_at as string,
  };
}

export async function sendInvoice(params: {
  actor: PlatformAdmin;
  invoiceId: string;
  to?: string;
}) {
  const invoice = await loadInvoice(params.invoiceId);
  if (!invoice) throw new Error('invalid_invoice_not_found');

  const settings = await getSettings();
  const to = params.to || invoice.toEmail;
  if (!to) throw new Error('invalid_invoice_missing_email');

  const result = await sendEmail({
    to,
    rendered: renderInvoiceEmail(
      invoice,
      settings,
      invoice.status === 'paid' ? 'receipt' : 'invoice'
    ),
    kind: invoice.status === 'paid' ? 'receipt' : 'invoice',
    settings,
    accountId: invoice.accountId,
    invoiceId: invoice.id,
    actor: params.actor,
  });

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { sent_at: now, to_email: to };
  if (invoice.status === 'draft') patch.status = 'sent';

  await adminDb().from('invoices').update(patch).eq('id', invoice.id);

  await logAdminAction({
    actor: params.actor,
    action: 'invoice.sent',
    targetType: 'invoice',
    targetId: invoice.id,
    targetLabel: invoice.number,
    details: { to, delivery: result.status, error: result.error ?? null },
  });

  return result;
}

export async function updateInvoice(params: {
  actor: PlatformAdmin;
  invoiceId: string;
  status?: InvoiceRow['status'];
  paidAt?: string | null;
  dueDate?: string;
  notes?: string | null;
  toEmail?: string | null;
}) {
  const invoice = await loadInvoice(params.invoiceId);
  if (!invoice) throw new Error('invalid_invoice_not_found');

  const patch: Record<string, unknown> = {};
  if (params.status) {
    patch.status = params.status;
    if (params.status === 'paid')
      patch.paid_at = params.paidAt ?? new Date().toISOString();
    if (params.status !== 'paid') patch.paid_at = null;
  }
  if (params.dueDate) patch.due_date = params.dueDate;
  if (params.notes !== undefined) patch.notes = params.notes;
  if (params.toEmail !== undefined) patch.to_email = params.toEmail;

  if (Object.keys(patch).length === 0)
    throw new Error('invalid_nothing_to_update');

  const { error } = await adminDb()
    .from('invoices')
    .update(patch)
    .eq('id', invoice.id);
  if (error) throw new Error(`admin_invoice_update_failed: ${error.message}`);

  await logAdminAction({
    actor: params.actor,
    action: 'invoice.updated',
    targetType: 'invoice',
    targetId: invoice.id,
    targetLabel: invoice.number,
    details: patch,
  });

  return { ok: true };
}

/**
 * Send every reminder that is due right now. Called by the panel button
 * and by the cron endpoint — same policy, same code path.
 */
export async function runReminders(actor: PlatformAdmin | null): Promise<{
  considered: number;
  sent: number;
  dryRun: number;
  failed: number;
}> {
  const settings = await getSettings();
  const invoices = await listInvoices();
  const policy = {
    daysBefore: settings.reminderDaysBefore,
    graceDays: settings.graceDays,
  };
  const now = new Date();

  let sent = 0;
  let dryRun = 0;
  let failed = 0;

  for (const invoice of invoices) {
    const decision = planReminder(
      {
        id: invoice.id,
        status: invoice.status,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        lastReminderAt: invoice.lastReminderAt,
        remindersSent: invoice.remindersSent,
      },
      policy,
      now
    );
    if (!decision) continue;

    const to = invoice.toEmail;
    if (!to) continue;

    const result = await sendEmail({
      to,
      rendered: renderReminderEmail(invoice, settings, decision.stage),
      kind: 'reminder',
      settings,
      accountId: invoice.accountId,
      invoiceId: invoice.id,
      actor,
    });

    if (result.status === 'sent') sent += 1;
    else if (result.status === 'dry_run') dryRun += 1;
    else failed += 1;

    await adminDb()
      .from('invoices')
      .update({
        last_reminder_at: now.toISOString(),
        reminders_sent: invoice.remindersSent + 1,
        status: decision.daysPastDue > 0 ? 'overdue' : invoice.status,
      })
      .eq('id', invoice.id);
  }

  if (sent + dryRun + failed > 0) {
    await logAdminAction({
      actor: actor ?? { userId: 'system', email: 'cron' },
      action: 'invoice.reminders.run',
      targetType: 'invoice',
      details: { sent, dry_run: dryRun, failed },
    });
  }

  return { considered: invoices.length, sent, dryRun, failed };
}

// ------------------------------------------------------------
// Plans, settings, admins, allowlist, channels
// ------------------------------------------------------------

export async function updatePlan(params: {
  actor: PlatformAdmin;
  code: string;
  priceMonthlyUsd?: number;
  priceAnnualUsd?: number | null;
  features?: Record<string, boolean>;
  limits?: Record<string, number | null>;
  isActive?: boolean;
  nameAr?: string | null;
  tagline?: string | null;
}) {
  const patch: Record<string, unknown> = {};
  if (params.priceMonthlyUsd !== undefined)
    patch.price_monthly_usd = toMoney(params.priceMonthlyUsd);
  if (params.priceAnnualUsd !== undefined) {
    patch.price_annual_usd =
      params.priceAnnualUsd === null ? null : toMoney(params.priceAnnualUsd);
  }
  if (params.features !== undefined) patch.features = params.features;
  if (params.limits !== undefined) patch.limits = params.limits;
  if (params.isActive !== undefined) patch.is_active = params.isActive;
  if (params.nameAr !== undefined) patch.name_ar = params.nameAr;
  if (params.tagline !== undefined) patch.tagline = params.tagline;

  if (Object.keys(patch).length === 0)
    throw new Error('invalid_nothing_to_update');

  const { error } = await adminDb()
    .from('plans')
    .update(patch)
    .eq('code', params.code);
  if (error) throw new Error(`admin_plan_update_failed: ${error.message}`);

  await logAdminAction({
    actor: params.actor,
    action: 'plan.updated',
    targetType: 'plan',
    targetId: params.code,
    details: patch,
  });
  return { ok: true };
}

const SETTINGS_COLUMNS: Record<string, string> = {
  signupEnabled: 'signup_enabled',
  signupMode: 'signup_mode',
  signupClosedMessage: 'signup_closed_message',
  maintenanceMode: 'maintenance_mode',
  maintenanceMessage: 'maintenance_message',
  supportEmail: 'support_email',
  billingFromName: 'billing_from_name',
  billingFromEmail: 'billing_from_email',
  billingReplyTo: 'billing_reply_to',
  reminderDaysBefore: 'reminder_days_before',
  graceDays: 'grace_days',
  currency: 'currency',
};

export async function updateSettings(
  actor: PlatformAdmin,
  input: Record<string, unknown>
) {
  const patch: Record<string, unknown> = { updated_by: actor.userId };
  for (const [key, column] of Object.entries(SETTINGS_COLUMNS)) {
    if (key in input) patch[column] = input[key];
  }
  if (Object.keys(patch).length === 1)
    throw new Error('invalid_nothing_to_update');

  if (
    typeof patch.signup_mode === 'string' &&
    !['open', 'invite_only', 'closed'].includes(patch.signup_mode)
  ) {
    throw new Error('invalid_signup_mode');
  }

  const { error } = await adminDb()
    .from('platform_settings')
    .update(patch)
    .eq('id', 1);
  if (error) throw new Error(`admin_settings_update_failed: ${error.message}`);

  await logAdminAction({
    actor,
    action: 'settings.updated',
    targetType: 'settings',
    targetId: '1',
    details: patch,
  });
  return { ok: true };
}

export async function addPlatformAdmin(params: {
  actor: PlatformAdmin;
  email: string;
  note?: string | null;
}) {
  const email = params.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('invalid_email');

  const db = adminDb();
  const { data: profile } = await db
    .from('profiles')
    .select('user_id, email')
    .ilike('email', email)
    .maybeSingle();
  if (!profile) throw new Error('invalid_user_not_found');

  const { error } = await db
    .from('platform_admins')
    .upsert(
      {
        user_id: profile.user_id as string,
        email,
        note: params.note ?? null,
        created_by: params.actor.userId,
      },
      { onConflict: 'user_id' }
    );
  if (error) throw new Error(`admin_admin_insert_failed: ${error.message}`);

  await logAdminAction({
    actor: params.actor,
    action: 'platform_admin.added',
    targetType: 'admin',
    targetId: profile.user_id as string,
    targetLabel: email,
  });
  return { ok: true };
}

export async function removePlatformAdmin(params: {
  actor: PlatformAdmin;
  userId: string;
}) {
  if (params.userId === params.actor.userId)
    throw new Error('invalid_cannot_remove_self');

  const { count } = await adminDb()
    .from('platform_admins')
    .select('user_id', { count: 'exact', head: true });
  if ((count ?? 0) <= 1) throw new Error('invalid_last_admin');

  const { error } = await adminDb()
    .from('platform_admins')
    .delete()
    .eq('user_id', params.userId);
  if (error) throw new Error(`admin_admin_delete_failed: ${error.message}`);

  await logAdminAction({
    actor: params.actor,
    action: 'platform_admin.removed',
    targetType: 'admin',
    targetId: params.userId,
  });
  return { ok: true };
}

export async function addToAllowlist(params: {
  actor: PlatformAdmin;
  email: string;
  note?: string | null;
  expiresAt?: string | null;
}) {
  const email = params.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('invalid_email');

  const { error } = await adminDb()
    .from('signup_allowlist')
    .upsert(
      {
        email,
        note: params.note ?? null,
        expires_at: params.expiresAt ?? null,
        used_at: null,
        used_by: null,
      },
      { onConflict: 'email' }
    );
  if (error) throw new Error(`admin_allowlist_insert_failed: ${error.message}`);

  await logAdminAction({
    actor: params.actor,
    action: 'signup.allowlisted',
    targetType: 'signup',
    targetId: email,
    targetLabel: email,
  });
  return { ok: true };
}

export async function removeFromAllowlist(params: {
  actor: PlatformAdmin;
  email: string;
}) {
  const { error } = await adminDb()
    .from('signup_allowlist')
    .delete()
    .eq('email', params.email.toLowerCase());
  if (error) throw new Error(`admin_allowlist_delete_failed: ${error.message}`);

  await logAdminAction({
    actor: params.actor,
    action: 'signup.allowlist_removed',
    targetType: 'signup',
    targetId: params.email,
  });
  return { ok: true };
}

export async function setChannelActive(params: {
  actor: PlatformAdmin;
  channel: 'whatsapp' | 'messenger' | 'instagram';
  id: string;
  active: boolean;
}) {
  const db = adminDb();
  if (params.channel === 'whatsapp') {
    const { error } = await db
      .from('whatsapp_config')
      .update({ status: params.active ? 'connected' : 'disconnected' })
      .eq('id', params.id);
    if (error) throw new Error(`admin_channel_update_failed: ${error.message}`);
  } else {
    const { error } = await db
      .from('channel_configs')
      .update({ is_active: params.active })
      .eq('id', params.id);
    if (error) throw new Error(`admin_channel_update_failed: ${error.message}`);
  }

  await logAdminAction({
    actor: params.actor,
    action: params.active ? 'channel.enabled' : 'channel.disabled',
    targetType: 'channel',
    targetId: params.id,
    details: { channel: params.channel },
  });
  return { ok: true };
}

export async function deleteChannel(params: {
  actor: PlatformAdmin;
  channel: 'whatsapp' | 'messenger' | 'instagram';
  id: string;
}) {
  const table =
    params.channel === 'whatsapp' ? 'whatsapp_config' : 'channel_configs';
  const { data: row } = await adminDb()
    .from(table)
    .select('account_id')
    .eq('id', params.id)
    .maybeSingle();
  const { error } = await adminDb().from(table).delete().eq('id', params.id);
  if (error) throw new Error(`admin_channel_delete_failed: ${error.message}`);

  await logAdminAction({
    actor: params.actor,
    action: 'channel.revoked',
    targetType: 'channel',
    targetId: params.id,
    targetLabel: params.channel,
    details: { account_id: row?.account_id ?? null },
  });
  return { ok: true };
}

export async function sendCustomEmailToAccount(params: {
  actor: PlatformAdmin;
  accountId: string;
  to: string;
  subject: string;
  body: string;
  toName?: string;
}) {
  const settings = await getSettings();
  const { renderCustomEmail } = await import('./email');
  const rendered = renderCustomEmail(settings, {
    toName: params.toName ?? '',
    body: params.body,
    subject: params.subject,
  });
  const result = await sendEmail({
    to: params.to,
    rendered,
    kind: 'custom',
    settings,
    accountId: params.accountId,
    actor: params.actor,
  });

  await logAdminAction({
    actor: params.actor,
    action: 'email.custom.sent',
    targetType: 'account',
    targetId: params.accountId,
    details: {
      to: params.to,
      subject: params.subject,
      delivery: result.status,
    },
  });

  return result;
}

// ------------------------------------------------------------
// Landing page content
// ------------------------------------------------------------

export interface LandingPlanPatch {
  code: string;
  nameAr?: string | null;
  landingDescAr?: string | null;
  landingDescEn?: string | null;
  priceMonthlyUsd?: number;
  priceAnnualUsd?: number | null;
  isFeatured?: boolean;
  isActive?: boolean;
  landingFeatures?: string[];
  limits?: Record<string, number | null>;
}

export interface LandingContactPatch {
  salesEmail: string;
  salesPhone?: string | null;
  whatsappNumber?: string | null;
  responseTimeAr?: string;
  responseTimeEn?: string;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed ? trimmed : null;
}

export async function updateLandingContent(params: {
  actor: PlatformAdmin;
  contact: LandingContactPatch;
  plans: LandingPlanPatch[];
}) {
  const email = params.contact.salesEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error('invalid_email');
  }

  const db = adminDb();
  const { error: contactError } = await db.from('landing_settings').upsert({
    id: 1,
    sales_email: email,
    sales_phone: cleanText(params.contact.salesPhone, 40),
    whatsapp_number: cleanText(params.contact.whatsappNumber, 40),
    response_time_ar: cleanText(params.contact.responseTimeAr, 120) ?? 'خلال يوم عمل',
    response_time_en:
      cleanText(params.contact.responseTimeEn, 120) ?? 'Within one business day',
    updated_at: new Date().toISOString(),
    updated_by: params.actor.userId,
  });
  if (contactError) {
    throw new Error(`admin_landing_contact_failed: ${contactError.message}`);
  }

  for (const plan of params.plans) {
    const patch: Record<string, unknown> = {};
    if (plan.nameAr !== undefined) patch.name_ar = cleanText(plan.nameAr, 80);
    if (plan.landingDescAr !== undefined)
      patch.landing_desc_ar = cleanText(plan.landingDescAr, 400);
    if (plan.landingDescEn !== undefined)
      patch.landing_desc_en = cleanText(plan.landingDescEn, 400);
    if (plan.priceMonthlyUsd !== undefined)
      patch.price_monthly_usd = toMoney(Math.max(0, plan.priceMonthlyUsd));
    if (plan.priceAnnualUsd !== undefined) {
      patch.price_annual_usd =
        plan.priceAnnualUsd === null
          ? null
          : toMoney(Math.max(0, plan.priceAnnualUsd));
    }
    if (plan.isFeatured !== undefined) patch.is_featured = plan.isFeatured;
    if (plan.isActive !== undefined) patch.is_active = plan.isActive;
    if (plan.landingFeatures !== undefined)
      patch.landing_features = plan.landingFeatures.slice(0, 30);
    if (plan.limits !== undefined) {
      const limits: Record<string, number | null> = {};
      for (const [key, value] of Object.entries(plan.limits)) {
        limits[key] = value === null ? null : Math.max(0, Number(value));
      }
      patch.limits = limits;
    }
    if (Object.keys(patch).length === 0) continue;

    const { error } = await db.from('plans').update(patch).eq('code', plan.code);
    if (error) {
      throw new Error(`admin_landing_plan_failed: ${error.message}`);
    }
  }

  await logAdminAction({
    actor: params.actor,
    action: 'landing.updated',
    targetType: 'settings',
    targetId: 'landing',
    details: {
      contactEmail: email,
      plans: params.plans.map((plan) => plan.code),
    },
  });

  return { ok: true };
}
