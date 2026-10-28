import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // The public marketing site is served from /landing by next.config rewrites.
  // It needs no session work, and skipping Supabase here keeps anonymous
  // landing traffic fast and independent of the auth service.
  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/" ||
    pathname === "/ar" ||
    pathname === "/en" ||
    pathname.startsWith("/landing/") ||
    pathname.startsWith("/api/public/")
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  // Local dev with NEXT_PUBLIC_SUPABASE_FOLLOW_ORIGIN: the cookie NAME is
  // derived from the project URL, so middleware must agree with the browser's
  // origin or every session reads as signed-out.
  // Use the raw Host header, not `request.nextUrl.origin`: Next normalises the
  // latter to the server's own origin (localhost), which changes the derived
  // cookie name and makes every session look signed-out.
  const requestHost = request.headers.get('host');
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_FOLLOW_ORIGIN === 'true' && requestHost
      ? `http://${requestHost}`
      : process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const supabase = createServerClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  };

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup' ||
      request.nextUrl.pathname === '/forgot-password')
  ) {
    const url = request.nextUrl.clone();
    const inviteToken = request.nextUrl.searchParams.get('invite');
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
      url.search = '';
    } else {
      url.pathname = '/dashboard';
      url.search = '';
    }
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Protected pages - redirect to login if not authenticated
  // Every top-level route under src/app/(dashboard)/ belongs here —
  // middleware.test.ts reads that directory and fails on a missing one.
  const protectedPaths = [
    '/dashboard',
    '/inbox',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/automations',
    '/flows',
    '/agents',
    '/notifications',
    '/settings',
    '/admin',
  ];
  if (
    !user &&
    protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone();
    const destination = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.pathname = '/login';
    url.search = '';
    // Carry the intended destination so /login can return there: an admin
    // opening /admin while signed out must not land on the tenant dashboard
    // (that is exactly what made the panel look like it "opened the normal
    // user panel").
    url.searchParams.set('next', destination);
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // API routes that need auth (not webhooks)
  if (
    !user &&
    request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
    !request.nextUrl.pathname.includes('/webhook')
  ) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
