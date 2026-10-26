import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'

/**
 * Base URL for the server-side Supabase client.
 *
 * `NEXT_PUBLIC_SUPABASE_FOLLOW_ORIGIN=true` (local dev only) makes the server
 * use the SAME origin the browser used. That is not cosmetic: `@supabase/ssr`
 * derives its cookie name from the project URL, so a server client pointed at
 * another host looks for `sb-192-auth-token` while the browser wrote
 * `sb-10-auth-token` — every request then reads as "not signed in" and the app
 * bounces back to /login with no error to show for it.
 */
async function supabaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (process.env.NEXT_PUBLIC_SUPABASE_FOLLOW_ORIGIN !== 'true') return configured

  try {
    const host = (await headers()).get('host')
    if (host) return `http://${host}`
  } catch {
    // Outside a request scope (build, scripts) — fall through.
  }
  return configured
}

export async function createClient() {
  const cookieStore = await cookies()
  const url = await supabaseUrl()

  return createServerClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}
