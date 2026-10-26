'use client';

/**
 * Client-side helper for the admin mutation endpoints.
 *
 * Keeps the three things every admin action needs in one place: JSON in,
 * JSON out, and an Error whose message is a stable code the UI can
 * translate (`invalid_email`, `smtp_not_configured`, …).
 */

export async function adminRequest<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST'
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(data?.error ?? `http_${response.status}`);
  }
  return (data ?? ({} as T)) as T;
}

export async function adminPatch<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  return adminRequest<T>(path, body, 'PATCH');
}
