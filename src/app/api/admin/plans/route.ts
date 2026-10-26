/**
 * /api/admin/plans — edit the plan catalogue (prices, features, limits).
 * Migration 063 made the catalogue data-driven precisely so this can
 * change without a deploy.
 */

import { NextResponse } from 'next/server';

import { requirePlatformAdmin, adminErrorResponse } from '@/lib/admin/auth';
import { updatePlan } from '@/lib/admin/mutations';

export async function PATCH(request: Request) {
  try {
    const actor = await requirePlatformAdmin();
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw new Error('invalid_body');
    const code = String(body.code ?? '');
    if (!code) throw new Error('invalid_plan_code');

    const result = await updatePlan({
      actor,
      code,
      priceMonthlyUsd:
        body.priceMonthlyUsd === undefined
          ? undefined
          : Number(body.priceMonthlyUsd),
      priceAnnualUsd:
        body.priceAnnualUsd === undefined
          ? undefined
          : body.priceAnnualUsd === null
            ? null
            : Number(body.priceAnnualUsd),
      features: (body.features as Record<string, boolean>) ?? undefined,
      limits: (body.limits as Record<string, number | null>) ?? undefined,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      nameAr: typeof body.nameAr === 'string' ? body.nameAr : undefined,
      tagline: typeof body.tagline === 'string' ? body.tagline : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
