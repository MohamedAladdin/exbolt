/**
 * PATCH /api/admin/landing — edit the public landing page's commercial content:
 * sales contact block and each plan's price, limits, copy, featured flag and
 * feature bullets. Platform-admin only.
 */

import { NextResponse } from 'next/server';

import { requirePlatformAdmin, adminErrorResponse } from '@/lib/admin/auth';
import {
  updateLandingContent,
  type LandingContactPatch,
  type LandingPlanPatch,
} from '@/lib/admin/mutations';
import { MARKETING_FEATURES } from '@/lib/landing/features';

export async function PATCH(request: Request) {
  try {
    const actor = await requirePlatformAdmin();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new Error('invalid_body');

    const contact = body.contact as Record<string, unknown> | undefined;
    if (!contact || typeof contact.salesEmail !== 'string') {
      return NextResponse.json({ error: 'invalid_contact' }, { status: 400 });
    }

    const rawPlans = Array.isArray(body.plans) ? body.plans : [];
    if (rawPlans.length > 10) throw new Error('invalid_plans');

    const allowedFeatures = new Set<string>(MARKETING_FEATURES);
    const plans: LandingPlanPatch[] = rawPlans.map((raw) => {
      const plan = (raw ?? {}) as Record<string, unknown>;
      if (typeof plan.code !== 'string' || !plan.code) throw new Error('invalid_plan_code');

      const features = Array.isArray(plan.landingFeatures)
        ? plan.landingFeatures.filter(
            (code): code is string => typeof code === 'string' && allowedFeatures.has(code)
          )
        : undefined;

      const numbers: Record<string, unknown> = (plan.limits as Record<string, unknown>) ?? {};
      const limits: Record<string, number | null> | undefined =
        plan.limits !== undefined
          ? Object.fromEntries(
              Object.entries(numbers).map(([key, value]) => [
                key,
                value === null || value === '' ? null : Math.max(0, Number(value) || 0),
              ])
            )
          : undefined;

      return {
        code: plan.code,
        nameAr: typeof plan.nameAr === 'string' ? plan.nameAr : undefined,
        landingDescAr:
          typeof plan.landingDescAr === 'string' ? plan.landingDescAr : undefined,
        landingDescEn:
          typeof plan.landingDescEn === 'string' ? plan.landingDescEn : undefined,
        priceMonthlyUsd:
          plan.priceMonthlyUsd === undefined ? undefined : Number(plan.priceMonthlyUsd) || 0,
        priceAnnualUsd:
          plan.priceAnnualUsd === undefined
            ? undefined
            : plan.priceAnnualUsd === null
              ? null
              : Number(plan.priceAnnualUsd) || 0,
        isFeatured: typeof plan.isFeatured === 'boolean' ? plan.isFeatured : undefined,
        isActive: typeof plan.isActive === 'boolean' ? plan.isActive : undefined,
        landingFeatures: features,
        limits,
      };
    });

    const contactPatch: LandingContactPatch = {
      salesEmail: contact.salesEmail,
      salesPhone: typeof contact.salesPhone === 'string' ? contact.salesPhone : undefined,
      whatsappNumber:
        typeof contact.whatsappNumber === 'string' ? contact.whatsappNumber : undefined,
      responseTimeAr:
        typeof contact.responseTimeAr === 'string' ? contact.responseTimeAr : undefined,
      responseTimeEn:
        typeof contact.responseTimeEn === 'string' ? contact.responseTimeEn : undefined,
    };

    const result = await updateLandingContent({ actor, contact: contactPatch, plans });
    return NextResponse.json(result);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
