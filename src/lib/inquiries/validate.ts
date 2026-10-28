/**
 * Public landing-page enquiry: the shape, the limits, and the rules.
 *
 * Pure functions only — no database, no Next.js — so the route stays thin and
 * the validation is unit-testable. The route adds transport concerns
 * (CORS, rate limiting, service-role insert).
 */

export const INQUIRY_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'won',
  'lost',
  'archived',
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const PLAN_CODES = ['core', 'growth', 'scale', 'unsure'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface InquiryInput {
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  teamSize: string | null;
  plan: string | null;
  message: string | null;
  locale: 'ar' | 'en';
  source: string;
  page: string | null;
}

export type ValidationResult =
  | { ok: true; value: InquiryInput }
  | { ok: false; error: string; field?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLAN_ALIASES: Record<string, PlanCode> = {
  core: 'core',
  growth: 'growth',
  scale: 'scale',
  'not sure': 'unsure',
  'not sure yet': 'unsure',
  'مش متأكد': 'unsure',
  unsure: 'unsure',
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optional(value: unknown, max: number): string | null {
  const cleaned = text(value, max);
  return cleaned ? cleaned : null;
}

export function normalizePlan(value: unknown): PlanCode | null {
  const raw = text(value, 40).toLowerCase();
  if (!raw) return null;
  const direct = PLAN_ALIASES[raw];
  if (direct) return direct;
  if (raw.includes('scale')) return 'scale';
  if (raw.includes('growth')) return 'growth';
  if (raw.includes('core')) return 'core';
  return null;
}

export function validateInquiry(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const raw = body as Record<string, unknown>;

  // Silent drop for bots that fill the hidden field. The caller returns a
  // success-shaped response so the bot learns nothing.
  if (text(raw.website, 200)) {
    return { ok: false, error: 'honeypot' };
  }

  const name = text(raw.name, 120);
  if (name.length < 2) {
    return { ok: false, error: 'invalid_name', field: 'name' };
  }

  const email = text(raw.email, 180).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: 'invalid_email', field: 'email' };
  }

  const locale = raw.locale === 'en' ? 'en' : 'ar';
  const source = text(raw.source, 60) || 'landing';
  const plan = normalizePlan(raw.plan);

  return {
    ok: true,
    value: {
      name,
      company: optional(raw.company, 160),
      email,
      phone: optional(raw.phone, 40),
      teamSize: optional(raw.teamSize, 40),
      plan,
      message: optional(raw.message, 2000),
      locale,
      source,
      page: optional(raw.page, 300),
    },
  };
}

export function isInquiryStatus(value: unknown): value is InquiryStatus {
  return (
    typeof value === 'string' &&
    (INQUIRY_STATUSES as readonly string[]).includes(value)
  );
}
