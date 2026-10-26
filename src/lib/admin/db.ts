/**
 * Service-role client for the super-admin panel.
 *
 * Same shape as `src/lib/flows/admin-client.ts` and
 * `src/lib/automations/admin-client.ts`: one lazy singleton, no
 * session persistence. Every caller MUST have gone through
 * `requirePlatformAdmin()` first — this client bypasses RLS.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function adminDb(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        'admin_db_not_configured: Supabase URL / service role key missing'
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
