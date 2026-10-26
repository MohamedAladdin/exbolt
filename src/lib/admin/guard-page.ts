/**
 * Page-level gate for the admin routes.
 *
 * Signed out → /login. Signed in but not a platform admin → /dashboard
 * (no hint that /admin exists). Both are redirects, so a page never
 * renders with an empty admin identity.
 */

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { requirePlatformAdmin, type PlatformAdmin } from './auth';

export async function guardAdminPage(): Promise<PlatformAdmin> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  try {
    return await requirePlatformAdmin();
  } catch {
    redirect('/dashboard');
  }
}
