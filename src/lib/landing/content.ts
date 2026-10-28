/**
 * Public landing-page read model.
 *
 * Everything the marketing page shows about money and contact — plan prices,
 * limits, chosen feature bullets, descriptions, the featured badge, and the
 * sales email/phone — is read from the database here. The page ships static
 * copy for crawlers and first paint, then refreshes these blocks from
 * /api/public/landing.
 */

import { adminDb } from '@/lib/admin/db';
import { FEATURE_LABELS, MARKETING_ONLY } from './features';

export type LandingLocale = 'ar' | 'en';

export interface LandingPlan {
  code: string;
  name: string;
  subtitle: string | null;
  description: string;
  priceMonthly: number;
  priceAnnual: number | null;
  featured: boolean;
  badge: string;
  limits: string[];
  features: string[];
}

export interface LandingContact {
  email: string;
  phone: string | null;
  whatsapp: string | null;
  responseTime: string;
}

export interface LandingContent {
  locale: LandingLocale;
  contact: LandingContact;
  plans: LandingPlan[];
  updatedAt: string | null;
}

function number(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function limitText(key: string, raw: unknown, locale: LandingLocale): string | null {
  const ar = locale === 'ar';
  const value = raw === null || raw === undefined ? null : number(raw);
  if (key === 'ai_agents' && (value === null || value === 0)) return null;

  if (key === 'channels') {
    if (value === null) return ar ? 'قنوات غير محدودة' : 'Unlimited channels';
    if (value === 1) return ar ? 'قناة واحدة' : '1 channel';
    return ar ? `${value} قنوات` : `${value} channels`;
  }
  if (key === 'team_members') {
    if (value === null) return ar ? 'مستخدمون غير محدودين' : 'Unlimited users';
    if (value === 1) return ar ? 'مستخدم واحد' : '1 user';
    return ar ? `${value} مستخدمين` : `${value} users`;
  }
  if (key === 'broadcast_monthly') {
    if (value === null) return ar ? 'رسائل حملات غير محدودة' : 'Unlimited campaign messages';
    return ar
      ? `${value.toLocaleString('en-US')} رسالة حملة / شهر`
      : `${value.toLocaleString('en-US')} campaign messages / month`;
  }
  if (key === 'ai_agents') {
    if (value === 1) return ar ? 'وكيل AI واحد' : '1 AI agent';
    return ar ? `${value} وكلاء AI` : `${value} AI agents`;
  }
  return null;
}

export async function getLandingContent(locale: LandingLocale): Promise<LandingContent> {
  const db = adminDb();
  const [plansResult, settingsResult] = await Promise.all([
    db.from('plans').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
    db.from('landing_settings').select('*').eq('id', 1).maybeSingle(),
  ]);

  if (plansResult.error) {
    console.error('[landing] plans read failed:', plansResult.error.message);
  }
  if (settingsResult.error) {
    console.error('[landing] settings read failed:', settingsResult.error.message);
  }

  const settings = (settingsResult.data ?? {}) as Record<string, unknown>;
  const ar = locale === 'ar';

  const plans = ((plansResult.data ?? []) as Record<string, unknown>[])
    .map((row): LandingPlan | null => {
      const enabled = (row.features as Record<string, unknown>) ?? {};
      const chosen = Array.isArray(row.landing_features)
        ? (row.landing_features as string[])
        : [];
      const features = chosen
        .filter((code) => MARKETING_ONLY.has(code) || enabled[code] !== false)
        .map((code) => FEATURE_LABELS[code]?.[locale])
        .filter((label): label is string => Boolean(label));

      const limits = ['channels', 'team_members', 'broadcast_monthly', 'ai_agents']
        .map((key) => limitText(key, (row.limits as Record<string, unknown>)?.[key], locale))
        .filter((label): label is string => Boolean(label));

      const description =
        (ar ? row.landing_desc_ar : row.landing_desc_en) ?? row.tagline ?? '';

      return {
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
        subtitle: ar ? String(row.name_ar ?? '') || null : null,
        description: String(description),
        priceMonthly: number(row.price_monthly_usd),
        priceAnnual: row.price_annual_usd === null ? null : number(row.price_annual_usd),
        featured: row.is_featured === true,
        badge: row.is_featured === true ? (ar ? 'الأكثر اختيارًا' : 'Most chosen') : '',
        limits,
        features,
      };
    })
    .filter((plan): plan is LandingPlan => Boolean(plan?.code));

  return {
    locale,
    contact: {
      email: String(settings.sales_email ?? 'sales@excal.uk'),
      phone: settings.sales_phone ? String(settings.sales_phone) : null,
      whatsapp: settings.whatsapp_number ? String(settings.whatsapp_number) : null,
      responseTime: String(
        (ar ? settings.response_time_ar : settings.response_time_en) ??
          (ar ? 'خلال يوم عمل' : 'Within one business day')
      ),
    },
    plans,
    updatedAt: settings.updated_at ? String(settings.updated_at) : null,
  };
}
