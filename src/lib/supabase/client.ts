import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

export function createClient() {
  if (browserClient) return browserClient

  // `NEXT_PUBLIC_SUPABASE_FOLLOW_ORIGIN=true` makes the browser talk to the
  // origin it loaded the app from, instead of a host baked in at build time.
  //
  // Why: one local build is served on several hostnames (127.0.0.1, the WiFi
  // LAN IP, the direct 10.0.0.1 link to the Windows box). Supabase calls to
  // one of those hosts fail — or are cross-origin — when the page was opened
  // on another. Combined with `SUPABASE_PROXY=true` (which rewrites
  // /auth,/rest,/storage to the local Supabase) every hostname then works
  // from one build. Never set this in production: hosted Supabase is a
  // different origin from the app on purpose.
  const followOrigin =
    process.env.NEXT_PUBLIC_SUPABASE_FOLLOW_ORIGIN === 'true' &&
    typeof window !== 'undefined'

  browserClient = createBrowserClient(
    followOrigin ? window.location.origin : process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  return browserClient
}
