import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FEATURES,
  FEATURES,
  featuresFromPlan,
  hasFeature,
  type Entitlements,
} from './entitlements';

function entitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    plan: {
      id: 'p1',
      code: 'core',
      name: 'Core',
      name_ar: 'الأساسية',
      tagline: null,
      price_monthly_usd: 65,
      price_annual_usd: null,
      sort_order: 1,
    },
    status: 'active',
    billing_interval: 'monthly',
    current_period_end: null,
    trial_ends_at: null,
    features: { ...DEFAULT_FEATURES },
    limits: {},
    entitled: true,
    isDefault: false,
    ...overrides,
  };
}

describe('audit_log feature', () => {
  it('is part of the feature vocabulary', () => {
    expect(FEATURES).toContain('audit_log');
  });

  it('defaults to OFF, so a plan that never mentions it does not grant it', () => {
    expect(DEFAULT_FEATURES.audit_log).toBe(false);
    // The CORE seed in migration 071 writes `false`; a plan row created
    // by hand without the key must resolve the same way.
    expect(featuresFromPlan({}).audit_log).toBe(false);
    expect(featuresFromPlan({ audit_log: true }).audit_log).toBe(true);
  });

  it('is denied for a CORE entitlement and granted on GROWTH', () => {
    const core = entitlements();
    expect(hasFeature(core, 'audit_log')).toBe(false);

    const growth = entitlements({
      features: { ...DEFAULT_FEATURES, audit_log: true },
    });
    expect(hasFeature(growth, 'audit_log')).toBe(true);
  });

  it('stays denied when the subscription is not entitling', () => {
    const canceled = entitlements({
      features: { ...DEFAULT_FEATURES, audit_log: true },
      status: 'canceled',
      entitled: false,
    });
    expect(hasFeature(canceled, 'audit_log')).toBe(false);
  });

  it('reads the flag out of a raw plans.features blob', () => {
    const resolved = featuresFromPlan({
      inbox: true,
      audit_log: true,
      not_a_feature: true,
    });
    expect(resolved.audit_log).toBe(true);
    expect(resolved.inbox).toBe(true);
    expect('not_a_feature' in resolved).toBe(false);
  });
});
