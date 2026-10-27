import { afterEach, describe, expect, it, vi } from 'vitest';

import { subscribePageToApp } from './graph-api';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('subscribePageToApp', () => {
  it('posts subscribed_fields — Graph rejects the call without them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await subscribePageToApp({
      externalId: '569851976479351',
      accessToken: 'page-token',
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://graph.facebook.com/v23.0/569851976479351/subscribed_apps'
    );
    expect(init.method).toBe('POST');
    const body = String(init.body);
    expect(body).toContain('subscribed_fields=');
    expect(decodeURIComponent(body)).toContain(
      'subscribed_fields=messages,messaging_postbacks,message_reactions'
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer page-token');
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('surfaces the Graph error instead of reporting success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: { message: '(#200) Requires pages_manage_metadata permission' },
        })
      )
    );

    const result = await subscribePageToApp({
      externalId: '1',
      accessToken: 't',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('pages_manage_metadata');
  });

  it('reports a network failure as an error, never as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    const result = await subscribePageToApp({ externalId: '1', accessToken: 't' });

    expect(result).toEqual({ ok: false, error: 'ECONNRESET' });
  });
});
