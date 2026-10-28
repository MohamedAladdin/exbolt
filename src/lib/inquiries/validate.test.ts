import { describe, expect, it } from 'vitest';

import { normalizePlan, validateInquiry } from './validate';

const valid = {
  name: 'مصطفى كامل',
  company: 'كامل جروب',
  email: 'Mostafa@Example.com',
  phone: '+20 100 000 0000',
  teamSize: '6–15',
  plan: 'Growth',
  message: 'عايزين نشوف النظام',
  locale: 'ar',
  source: 'landing',
  page: '/ar/',
};

describe('validateInquiry', () => {
  it('accepts a complete payload and normalises the email and plan', () => {
    const result = validateInquiry(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.email).toBe('mostafa@example.com');
    expect(result.value.plan).toBe('growth');
    expect(result.value.name).toBe('مصطفى كامل');
  });

  it('rejects a missing or too-short name', () => {
    expect(validateInquiry({ ...valid, name: ' ' })).toEqual({
      ok: false,
      error: 'invalid_name',
      field: 'name',
    });
  });

  it('rejects a malformed email', () => {
    const result = validateInquiry({ ...valid, email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_email');
  });

  it('silently drops the honeypot', () => {
    expect(validateInquiry({ ...valid, website: 'https://spam.example' })).toEqual({
      ok: false,
      error: 'honeypot',
    });
  });

  it('defaults the locale to Arabic and trims long text', () => {
    const result = validateInquiry({ ...valid, locale: 'fr', message: 'x'.repeat(3000) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.locale).toBe('ar');
    expect(result.value.message).toHaveLength(2000);
  });

  it('rejects non-object bodies', () => {
    expect(validateInquiry(null).ok).toBe(false);
    expect(validateInquiry('hello').ok).toBe(false);
    expect(validateInquiry([]).ok).toBe(false);
  });
});

describe('normalizePlan', () => {
  it('maps labels, aliases and unknown values', () => {
    expect(normalizePlan('Core')).toBe('core');
    expect(normalizePlan('Growth')).toBe('growth');
    expect(normalizePlan('Scale')).toBe('scale');
    expect(normalizePlan('مش متأكد')).toBe('unsure');
    expect(normalizePlan('enterprise')).toBeNull();
    expect(normalizePlan(undefined)).toBeNull();
  });
});
