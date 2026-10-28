/**
 * Read models for the super-admin panel.
 *
 * Server-only. Everything here goes through the service-role client, so
 * each exported function is called from a page that has already run
 * `requirePlatformAdmin()` (or from an API route that did).
 *
 * The dataset is small by design (one row per tenant), so the panel reads
 * wide and joins in TypeScript instead of pretending PostgREST is a
 * query planner. The one thing that *is* pushed into SQL is
 * `admin_account_stats()` — per-account counters across five tables.
 */

import { adminDb } from './db';
import { monthlyEquivalent, toMoney, type InvoiceStatus } from './invoice';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type AccountStatus = 'active' | 'suspended' | 'archived' | 'banned';

export interface AccountRow {
  id: string;
  name: string;
  brandName: string | null;
  status: AccountStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  ownerUserId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  billingInterval: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  members: number;
  contacts: number;
  conversations: number;
  messages30d: number;
  channels: number;
  lastActivity: string | null;
}

export interface PlatformOverview {
  accounts: {
    total: number;
    active: number;
    suspended: number;
    archived: number;
    banned: number;
  };
  signups: { last7d: number; last30d: number };
  subscriptions: {
    active: number;
    trial: number;
    pastDue: number;
    canceled: number;
  };
  mrrUsd: number;
  invoices: {
    open: number;
    overdue: number;
    overdueAmount: number;
    paidThisMonth: number;
  };
  channels: number;
  expiringTokens: number;
  registration: { enabled: boolean; mode: string; message: string | null };
  recentAccounts: AccountRow[];
  /** Trials whose `trial_ends_at` is inside the next 7 days. */
  trialsEndingSoon: AccountRow[];
}

export interface MemberRow {
  userId: string;
  profileId: string;
  fullName: string;
  email: string;
  role: string;
  blockedAt: string | null;
  blockedReason: string | null;
  createdAt: string | null;
}

export interface GrantRow {
  id: string;
  kind: string;
  key: string | null;
  value: unknown;
  reason: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  grantedByEmail: string | null;
}

export interface InvoiceRow {
  id: string;
  number: string;
  accountId: string;
  accountName?: string;
  accountStatus?: string;
  status: InvoiceStatus;
  currency: string;
  amount: number;
  tax: number;
  issueDate: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  planCode: string | null;
  lineItems: { description: string; quantity: number; unit_price: number }[];
  notes: string | null;
  toEmail: string | null;
  toName: string | null;
  sentAt: string | null;
  paidAt: string | null;
  lastReminderAt: string | null;
  remindersSent: number;
  createdAt: string;
}

export interface ChannelRow {
  id: string;
  accountId: string;
  accountName: string;
  accountStatus: string;
  channel: 'whatsapp' | 'messenger' | 'instagram';
  externalId: string;
  displayName: string | null;
  isActive: boolean;
  status: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  tagline: string | null;
  landingDescAr: string | null;
  landingDescEn: string | null;
  landingFeatures: string[];
  isFeatured: boolean;
  priceMonthlyUsd: number;
  priceAnnualUsd: number | null;
  features: Record<string, unknown>;
  limits: Record<string, unknown>;
  sortOrder: number;
  isActive: boolean;
  subscribers: number;
}

export interface SettingsRow {
  signupEnabled: boolean;
  signupMode: 'open' | 'invite_only' | 'closed';
  signupClosedMessage: string | null;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  supportEmail: string | null;
  billingFromName: string;
  billingFromEmail: string | null;
  billingReplyTo: string | null;
  reminderDaysBefore: number;
  graceDays: number;
  currency: string;
  updatedAt: string | null;
}

export interface AuditRow {
  id: number;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface EmailRow {
  id: string;
  accountId: string | null;
  invoiceId: string | null;
  kind: string;
  toEmail: string;
  subject: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

// ------------------------------------------------------------
// Settings
// ------------------------------------------------------------

const DEFAULT_SETTINGS: SettingsRow = {
  signupEnabled: true,
  signupMode: 'open',
  signupClosedMessage: null,
  maintenanceMode: false,
  maintenanceMessage: null,
  supportEmail: null,
  billingFromName: 'EXCAL LABS',
  billingFromEmail: null,
  billingReplyTo: null,
  reminderDaysBefore: 3,
  graceDays: 7,
  currency: 'USD',
  updatedAt: null,
};

function mapSettings(row: Record<string, unknown> | null): SettingsRow {
  if (!row) return DEFAULT_SETTINGS;
  return {
    signupEnabled: row.signup_enabled !== false,
    signupMode: (row.signup_mode as SettingsRow['signupMode']) ?? 'open',
    signupClosedMessage: (row.signup_closed_message as string | null) ?? null,
    maintenanceMode: row.maintenance_mode === true,
    maintenanceMessage: (row.maintenance_message as string | null) ?? null,
    supportEmail: (row.support_email as string | null) ?? null,
    billingFromName: (row.billing_from_name as string | null) ?? 'EXCAL LABS',
    billingFromEmail: (row.billing_from_email as string | null) ?? null,
    billingReplyTo: (row.billing_reply_to as string | null) ?? null,
    reminderDaysBefore: Number(row.reminder_days_before ?? 3),
    graceDays: Number(row.grace_days ?? 7),
    currency: (row.currency as string | null) ?? 'USD',
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export async function getSettings(): Promise<SettingsRow> {
  const { data, error } = await adminDb()
    .from('platform_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) console.error('[admin] settings read failed:', error.message);
  return mapSettings(data as Record<string, unknown> | null);
}

/**
 * The only settings a signed-out visitor may see: enough for the signup
 * form to say "registration is closed" without leaking billing config.
 */
export async function getPublicSignupState(): Promise<{
  enabled: boolean;
  mode: string;
  message: string | null;
}> {
  const settings = await getSettings();
  const enabled = settings.signupEnabled && settings.signupMode !== 'closed';
  return {
    enabled,
    mode: settings.signupMode,
    message: enabled ? null : (settings.signupClosedMessage ?? null),
  };
}

// ------------------------------------------------------------
// Accounts
// ------------------------------------------------------------

interface RawStats {
  account_id: string;
  members: number;
  contacts: number;
  conversations: number;
  messages_30d: number;
  channels: number;
  last_activity: string | null;
}

function mapAccount(
  account: Record<string, unknown>,
  owner: Record<string, unknown> | undefined,
  subscription: Record<string, unknown> | undefined,
  stats: RawStats | undefined
): AccountRow {
  const plan = (subscription?.plan ?? null) as Record<string, unknown> | null;
  return {
    id: account.id as string,
    name: (account.name as string) ?? '',
    brandName: (account.brand_name as string | null) ?? null,
    status: ((account.status as AccountStatus) ??
      'active') satisfies AccountStatus,
    statusReason: (account.status_reason as string | null) ?? null,
    statusChangedAt: (account.status_changed_at as string | null) ?? null,
    createdAt: (account.created_at as string) ?? '',
    ownerUserId: account.owner_user_id as string,
    ownerName: (owner?.full_name as string | null) ?? null,
    ownerEmail: (owner?.email as string | null) ?? null,
    planCode: (plan?.code as string | null) ?? null,
    planName: (plan?.name as string | null) ?? null,
    subscriptionStatus: (subscription?.status as string | null) ?? null,
    billingInterval: (subscription?.billing_interval as string | null) ?? null,
    currentPeriodEnd:
      (subscription?.current_period_end as string | null) ?? null,
    trialEndsAt: (subscription?.trial_ends_at as string | null) ?? null,
    members: Number(stats?.members ?? 0),
    contacts: Number(stats?.contacts ?? 0),
    conversations: Number(stats?.conversations ?? 0),
    messages30d: Number(stats?.messages_30d ?? 0),
    channels: Number(stats?.channels ?? 0),
    lastActivity: stats?.last_activity ?? null,
  };
}

export async function listAccounts(): Promise<AccountRow[]> {
  const db = adminDb();
  const [accounts, profiles, subscriptions, stats] = await Promise.all([
    db
      .from('accounts')
      .select(
        'id, name, brand_name, status, status_reason, status_changed_at, created_at, owner_user_id'
      )
      .order('created_at', { ascending: false }),
    db
      .from('profiles')
      .select('user_id, full_name, email, account_id, account_role'),
    db
      .from('account_subscriptions')
      .select(
        'account_id, status, billing_interval, current_period_end, trial_ends_at, plan:plans(code, name, name_ar, price_monthly_usd, price_annual_usd)'
      ),
    db.rpc('admin_account_stats'),
  ]);

  if (accounts.error)
    throw new Error(`admin_accounts_read_failed: ${accounts.error.message}`);

  const ownerByUser = new Map<string, Record<string, unknown>>();
  for (const profile of (profiles.data ?? []) as Record<string, unknown>[]) {
    ownerByUser.set(profile.user_id as string, profile);
  }
  const subscriptionByAccount = new Map<string, Record<string, unknown>>();
  for (const sub of (subscriptions.data ?? []) as Record<string, unknown>[]) {
    subscriptionByAccount.set(sub.account_id as string, sub);
  }
  const statsByAccount = new Map<string, RawStats>();
  for (const row of (stats.data ?? []) as RawStats[]) {
    statsByAccount.set(row.account_id, row);
  }

  return ((accounts.data ?? []) as Record<string, unknown>[]).map((account) =>
    mapAccount(
      account,
      ownerByUser.get(account.owner_user_id as string),
      subscriptionByAccount.get(account.id as string),
      statsByAccount.get(account.id as string)
    )
  );
}

export async function getAccount(id: string): Promise<AccountRow | null> {
  const rows = await listAccounts();
  return rows.find((row) => row.id === id) ?? null;
}

export async function listMembers(accountId: string): Promise<MemberRow[]> {
  const { data, error } = await adminDb()
    .from('profiles')
    .select(
      'id, user_id, full_name, email, account_role, blocked_at, blocked_reason, created_at'
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`admin_members_read_failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    userId: row.user_id as string,
    profileId: row.id as string,
    fullName: (row.full_name as string) ?? '',
    email: (row.email as string) ?? '',
    role: (row.account_role as string) ?? 'agent',
    blockedAt: (row.blocked_at as string | null) ?? null,
    blockedReason: (row.blocked_reason as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
  }));
}

export async function listGrants(accountId: string): Promise<GrantRow[]> {
  const { data, error } = await adminDb()
    .from('account_grants')
    .select(
      'id, kind, key, value, reason, expires_at, revoked_at, created_at, granted_by_email'
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`admin_grants_read_failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    key: (row.key as string | null) ?? null,
    value: row.value,
    reason: (row.reason as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    createdAt: (row.created_at as string) ?? '',
    grantedByEmail: (row.granted_by_email as string | null) ?? null,
  }));
}

export async function getSubscription(
  accountId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await adminDb()
    .from('account_subscriptions')
    .select('*, plan:plans(*)')
    .eq('account_id', accountId)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

// ------------------------------------------------------------
// Overview
// ------------------------------------------------------------

export async function getOverview(): Promise<PlatformOverview> {
  const db = adminDb();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    accounts,
    subs,
    invoices,
    channels,
    tokens,
    settings,
    signups30,
    signups7,
  ] = await Promise.all([
    listAccounts(),
    db
      .from('account_subscriptions')
      .select(
        'status, billing_interval, plan:plans(price_monthly_usd, price_annual_usd)'
      ),
    db
      .from('invoices')
      .select('status, amount, due_date, issued:issue_date, paid_at'),
    db.from('channel_configs').select('id', { count: 'exact', head: true }),
    db
      .from('whatsapp_config')
      .select('id, token_expires_at')
      .not('token_expires_at', 'is', null),
    getSettings(),
    db
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since30),
    db
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since7),
  ]);

  const subRows = (subs.data ?? []) as Record<string, unknown>[];
  const activeSubs = subRows.filter((row) => row.status === 'active');
  const mrrUsd = activeSubs.reduce((sum, row) => {
    const plan = (row.plan ?? {}) as Record<string, unknown>;
    return (
      sum +
      monthlyEquivalent(
        plan.price_monthly_usd,
        plan.price_annual_usd,
        (row.billing_interval as 'monthly' | 'annual') ?? 'monthly'
      )
    );
  }, 0);

  const invoiceRows = (invoices.data ?? []) as Record<string, unknown>[];
  const today = new Date();
  const open = invoiceRows.filter((row) =>
    ['sent', 'overdue'].includes(row.status as string)
  );
  const overdue = open.filter(
    (row) =>
      new Date(`${row.due_date as string}T23:59:59Z`).getTime() <
      today.getTime()
  );

  const expiringTokens = (
    (tokens.data ?? []) as { token_expires_at: string }[]
  ).filter((row) => {
    const expires = new Date(row.token_expires_at).getTime();
    return expires < Date.now() + 14 * 86_400_000;
  }).length;

  return {
    accounts: {
      total: accounts.length,
      active: accounts.filter((row) => row.status === 'active').length,
      suspended: accounts.filter((row) => row.status === 'suspended').length,
      archived: accounts.filter((row) => row.status === 'archived').length,
      banned: accounts.filter((row) => row.status === 'banned').length,
    },
    signups: {
      last7d: signups7.count ?? 0,
      last30d: signups30.count ?? 0,
    },
    subscriptions: {
      active: activeSubs.length,
      trial: subRows.filter((row) => row.status === 'trial').length,
      pastDue: subRows.filter((row) => row.status === 'past_due').length,
      canceled: subRows.filter((row) =>
        ['canceled', 'suspended'].includes(row.status as string)
      ).length,
    },
    mrrUsd: Math.round(mrrUsd * 100) / 100,
    invoices: {
      open: open.length,
      overdue: overdue.length,
      overdueAmount: overdue.reduce((sum, row) => sum + toMoney(row.amount), 0),
      paidThisMonth: invoiceRows.filter(
        (row) =>
          row.status === 'paid' &&
          (row.paid_at as string | null) &&
          new Date(row.paid_at as string) >= monthStart
      ).length,
    },
    channels:
      (channels.count ?? 0) +
      accounts.reduce((sum, row) => sum + (row.channels > 0 ? 1 : 0), 0),
    expiringTokens,
    registration: {
      enabled: settings.signupEnabled && settings.signupMode !== 'closed',
      mode: settings.signupMode,
      message: settings.signupClosedMessage,
    },
    recentAccounts: accounts.slice(0, 6),
    trialsEndingSoon: accounts.filter((row) => {
      if (row.subscriptionStatus !== 'trial' || !row.trialEndsAt) return false;
      const ends = new Date(row.trialEndsAt).getTime();
      return ends >= Date.now() && ends <= Date.now() + 7 * 86_400_000;
    }),
  };
}

// ------------------------------------------------------------
// Invoices
// ------------------------------------------------------------

function mapInvoice(row: Record<string, unknown>): InvoiceRow {
  const account = (row.account ?? null) as Record<string, unknown> | null;
  return {
    id: row.id as string,
    number: row.number as string,
    accountId: row.account_id as string,
    accountName: (account?.name as string | undefined) ?? undefined,
    accountStatus: (account?.status as string | undefined) ?? undefined,
    status: (row.status as InvoiceStatus) ?? 'draft',
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

export async function listInvoices(accountId?: string): Promise<InvoiceRow[]> {
  let query = adminDb()
    .from('invoices')
    .select('*, account:accounts(name, status)')
    .order('issue_date', { ascending: false })
    .limit(200);
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query;
  if (error) throw new Error(`admin_invoices_read_failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(mapInvoice);
}

export async function listInvoiceNumbers(): Promise<string[]> {
  const { data } = await adminDb()
    .from('invoices')
    .select('number')
    .limit(2000);
  return ((data ?? []) as { number: string }[]).map((row) => row.number);
}

// ------------------------------------------------------------
// Channels
// ------------------------------------------------------------

export async function listChannels(): Promise<ChannelRow[]> {
  const db = adminDb();
  const [whatsapp, social] = await Promise.all([
    db
      .from('whatsapp_config')
      .select(
        'id, account_id, phone_number_id, waba_id, status, connected_at, updated_at, token_expires_at, last_error, last_registration_error, account:accounts(name, status)'
      ),
    db
      .from('channel_configs')
      .select(
        'id, account_id, channel, external_id, display_name, is_active, updated_at, token_expires_at, last_error, account:accounts(name, status)'
      ),
  ]);

  const rows: ChannelRow[] = [];

  for (const row of (whatsapp.data ?? []) as Record<string, unknown>[]) {
    const account = (row.account ?? {}) as Record<string, unknown>;
    rows.push({
      id: row.id as string,
      accountId: row.account_id as string,
      accountName: (account.name as string) ?? '—',
      accountStatus: (account.status as string) ?? 'active',
      channel: 'whatsapp',
      externalId: (row.phone_number_id as string) ?? '',
      displayName: (row.waba_id as string | null) ?? null,
      isActive: row.status === 'connected',
      status: (row.status as string) ?? null,
      tokenExpiresAt: (row.token_expires_at as string | null) ?? null,
      lastError:
        ((row.last_error ?? row.last_registration_error) as string | null) ??
        null,
      updatedAt:
        ((row.updated_at ?? row.connected_at) as string | null) ?? null,
    });
  }

  for (const row of (social.data ?? []) as Record<string, unknown>[]) {
    const account = (row.account ?? {}) as Record<string, unknown>;
    rows.push({
      id: row.id as string,
      accountId: row.account_id as string,
      accountName: (account.name as string) ?? '—',
      accountStatus: (account.status as string) ?? 'active',
      channel: (row.channel as ChannelRow['channel']) ?? 'messenger',
      externalId: (row.external_id as string) ?? '',
      displayName: (row.display_name as string | null) ?? null,
      isActive: row.is_active === true,
      status: row.is_active === true ? 'connected' : 'disconnected',
      tokenExpiresAt: (row.token_expires_at as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? null,
    });
  }

  return rows.sort((a, b) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  );
}

// ------------------------------------------------------------
// Plans
// ------------------------------------------------------------

export async function listPlans(): Promise<PlanRow[]> {
  const db = adminDb();
  const [plans, subs] = await Promise.all([
    db.from('plans').select('*').order('sort_order', { ascending: true }),
    db.from('account_subscriptions').select('plan_id, status'),
  ]);
  const counts = new Map<string, number>();
  for (const row of (subs.data ?? []) as Record<string, unknown>[]) {
    if (['active', 'trial', 'past_due'].includes(row.status as string)) {
      const key = row.plan_id as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return ((plans.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    nameAr: (row.name_ar as string | null) ?? null,
    tagline: (row.tagline as string | null) ?? null,
    landingDescAr: (row.landing_desc_ar as string | null) ?? null,
    landingDescEn: (row.landing_desc_en as string | null) ?? null,
    landingFeatures: Array.isArray(row.landing_features)
      ? (row.landing_features as string[])
      : [],
    isFeatured: row.is_featured === true,
    priceMonthlyUsd: toMoney(row.price_monthly_usd),
    priceAnnualUsd:
      row.price_annual_usd === null ? null : toMoney(row.price_annual_usd),
    features: (row.features as Record<string, unknown>) ?? {},
    limits: (row.limits as Record<string, unknown>) ?? {},
    sortOrder: Number(row.sort_order ?? 0),
    isActive: row.is_active !== false,
    subscribers: counts.get(row.id as string) ?? 0,
  }));
}

export interface LandingSettingsRow {
  salesEmail: string;
  salesPhone: string | null;
  whatsappNumber: string | null;
  responseTimeAr: string;
  responseTimeEn: string;
}

export async function getLandingSettings(): Promise<LandingSettingsRow> {
  const { data, error } = await adminDb()
    .from('landing_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('[admin] getLandingSettings failed:', error.message);
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    salesEmail: String(row.sales_email ?? 'sales@excal.uk'),
    salesPhone: row.sales_phone ? String(row.sales_phone) : null,
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    responseTimeAr: String(row.response_time_ar ?? 'خلال يوم عمل'),
    responseTimeEn: String(row.response_time_en ?? 'Within one business day'),
  };
}

// ------------------------------------------------------------
// Admins, allowlist, audit, email log
// ------------------------------------------------------------

export async function listAdmins(): Promise<
  { userId: string; email: string; note: string | null; createdAt: string }[]
> {
  const { data, error } = await adminDb()
    .from('platform_admins')
    .select('user_id, email, note, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`admin_admins_read_failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    userId: row.user_id as string,
    email: row.email as string,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export async function listAllowlist(): Promise<
  {
    email: string;
    note: string | null;
    createdAt: string;
    expiresAt: string | null;
    usedAt: string | null;
  }[]
> {
  const { data } = await adminDb()
    .from('signup_allowlist')
    .select('email, note, created_at, expires_at, used_at')
    .order('created_at', { ascending: false })
    .limit(100);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    email: row.email as string,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
    usedAt: (row.used_at as string | null) ?? null,
  }));
}

export async function listAudit(
  limit = 100,
  accountId?: string
): Promise<AuditRow[]> {
  let query = adminDb()
    .from('admin_audit_log')
    .select(
      'id, actor_email, action, target_type, target_id, target_label, details, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (accountId) query = query.eq('target_id', accountId);
  const { data } = await query;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    actorEmail: (row.actor_email as string | null) ?? null,
    action: row.action as string,
    targetType: (row.target_type as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    targetLabel: (row.target_label as string | null) ?? null,
    details: (row.details as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  }));
}

export async function listEmails(
  limit = 60,
  accountId?: string
): Promise<EmailRow[]> {
  let query = adminDb()
    .from('outbound_emails')
    .select(
      'id, account_id, invoice_id, kind, to_email, subject, status, error, sent_at, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (accountId) query = query.eq('account_id', accountId);
  const { data } = await query;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    accountId: (row.account_id as string | null) ?? null,
    invoiceId: (row.invoice_id as string | null) ?? null,
    kind: row.kind as string,
    toEmail: row.to_email as string,
    subject: row.subject as string,
    status: row.status as string,
    error: (row.error as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

// ------------------------------------------------------------
// Landing-page enquiries
// ------------------------------------------------------------

export interface InquiryRow {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  team_size: string | null;
  plan: string | null;
  message: string | null;
  locale: string;
  source: string;
  page: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Newest first. The landing page gets a handful a day, so 300 is plenty. */
export async function listInquiries(limit = 300): Promise<InquiryRow[]> {
  const { data, error } = await adminDb()
    .from('inquiries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[admin] listInquiries failed:', error.message);
    return [];
  }
  return (data ?? []) as InquiryRow[];
}

// ------------------------------------------------------------
// Tenant plan requests
// ------------------------------------------------------------

export interface AccountRequestRow {
  id: string;
  account_id: string;
  user_id: string;
  accountName: string | null;
  requesterEmail: string | null;
  requesterName: string | null;
  kind: 'renewal' | 'change_plan';
  current_plan_code: string | null;
  requested_plan_code: string | null;
  billing_interval: 'monthly' | 'annual';
  message: string | null;
  status: 'new' | 'in_review' | 'done' | 'declined';
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAccountRequests(limit = 300): Promise<AccountRequestRow[]> {
  const { data, error } = await adminDb()
    .from('account_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[admin] listAccountRequests failed:', error.message);
    return [];
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const accountIds = [...new Set(rows.map((row) => String(row.account_id)))];
  const userIds = [...new Set(rows.map((row) => String(row.user_id)))];

  const [accounts, profiles] = await Promise.all([
    accountIds.length
      ? adminDb().from('accounts').select('id, name').in('id', accountIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    userIds.length
      ? adminDb()
          .from('profiles')
          .select('user_id, email, full_name')
          .in('user_id', userIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const accountMap = new Map(
    (accounts.data ?? []).map((row) => [String(row.id), String(row.name)])
  );
  const profileMap = new Map(
    (profiles.data ?? []).map((row) => [
      String(row.user_id),
      {
        email: row.email ? String(row.email) : null,
        name: row.full_name ? String(row.full_name) : null,
      },
    ])
  );

  return rows.map((row) => {
    const profile = profileMap.get(String(row.user_id));
    return {
      id: String(row.id),
      account_id: String(row.account_id),
      user_id: String(row.user_id),
      accountName: accountMap.get(String(row.account_id)) ?? null,
      requesterEmail: profile?.email ?? null,
      requesterName: profile?.name ?? null,
      kind: row.kind as AccountRequestRow['kind'],
      current_plan_code: (row.current_plan_code as string | null) ?? null,
      requested_plan_code: (row.requested_plan_code as string | null) ?? null,
      billing_interval: row.billing_interval as AccountRequestRow['billing_interval'],
      message: (row.message as string | null) ?? null,
      status: row.status as AccountRequestRow['status'],
      admin_notes: (row.admin_notes as string | null) ?? null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  });
}

export async function countOpenRequests(): Promise<number> {
  const { count, error } = await adminDb()
    .from('account_requests')
    .select('id', { count: 'exact', head: true })
    .in('status', ['new', 'in_review']);

  if (error) {
    console.error('[admin] countOpenRequests failed:', error.message);
    return 0;
  }
  return count ?? 0;
}
