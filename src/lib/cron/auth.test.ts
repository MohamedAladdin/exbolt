import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cronAuthorized, cronConfigured } from './auth';

const ORIGINAL = {
  admin: process.env.ADMIN_CRON_SECRET,
  automation: process.env.AUTOMATION_CRON_SECRET,
};

function request(headers: Record<string, string> = {}, query = ''): Request {
  return new Request(`https://bolt.test/api/admin/cron/x${query}`, { headers });
}

beforeEach(() => {
  delete process.env.ADMIN_CRON_SECRET;
  delete process.env.AUTOMATION_CRON_SECRET;
});

afterEach(() => {
  if (ORIGINAL.admin === undefined) delete process.env.ADMIN_CRON_SECRET;
  else process.env.ADMIN_CRON_SECRET = ORIGINAL.admin;
  if (ORIGINAL.automation === undefined) delete process.env.AUTOMATION_CRON_SECRET;
  else process.env.AUTOMATION_CRON_SECRET = ORIGINAL.automation;
});

describe('cron auth', () => {
  it('refuses everything when no secret is configured', () => {
    expect(cronConfigured()).toBe(false);
    expect(cronAuthorized(request({ 'x-admin-secret': 'anything' }))).toBe(false);
    expect(cronAuthorized(request({}, '?secret=anything'))).toBe(false);
  });

  it('accepts the admin secret in either header', () => {
    process.env.ADMIN_CRON_SECRET = 'top-secret';
    expect(cronConfigured()).toBe(true);
    expect(cronAuthorized(request({ 'x-admin-secret': 'top-secret' }))).toBe(true);
    expect(cronAuthorized(request({ 'x-cron-secret': 'top-secret' }))).toBe(true);
  });

  it('accepts the secret as a query param (manual runs)', () => {
    process.env.ADMIN_CRON_SECRET = 'top-secret';
    expect(cronAuthorized(request({}, '?secret=top-secret'))).toBe(true);
    expect(cronAuthorized(request({}, '?secret=nope'))).toBe(false);
  });

  it('prefers ADMIN_CRON_SECRET over the automation fallback', () => {
    process.env.ADMIN_CRON_SECRET = 'admin-secret';
    process.env.AUTOMATION_CRON_SECRET = 'automation-secret';
    expect(cronAuthorized(request({ 'x-admin-secret': 'admin-secret' }))).toBe(true);
    expect(cronAuthorized(request({ 'x-admin-secret': 'automation-secret' }))).toBe(false);
  });

  it('falls back to AUTOMATION_CRON_SECRET when no admin secret is set', () => {
    process.env.AUTOMATION_CRON_SECRET = 'automation-secret';
    expect(cronAuthorized(request({ 'x-admin-secret': 'automation-secret' }))).toBe(true);
  });

  it('rejects a prefix or a different-length secret', () => {
    process.env.ADMIN_CRON_SECRET = 'top-secret';
    expect(cronAuthorized(request({ 'x-admin-secret': 'top-secre' }))).toBe(false);
    expect(cronAuthorized(request({ 'x-admin-secret': 'top-secret-longer' }))).toBe(false);
    expect(cronAuthorized(request({ 'x-admin-secret': '' }))).toBe(false);
  });
});
