/**
 * Shared CORS rules for the public endpoints consumed by the static landing
 * page (a different origin from the app).
 */

const DEFAULT_ORIGINS = [
  'https://exbolt.excal.uk',
  'https://www.exbolt.excal.uk',
  'https://bolt.excal.uk',
  'https://bolt.excal.com',
  'https://www.bolt.excal.com',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3111',
  'http://127.0.0.1:3111',
];

export function allowedOrigins(): string[] {
  const configured = process.env.INQUIRY_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_ORIGINS;
}

export function isAllowedOrigin(origin: string | null): boolean {
  return !origin || allowedOrigins().includes(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin);
  return {
    ...(origin && allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
