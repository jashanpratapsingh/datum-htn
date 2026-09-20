/**
 * Session refresh and route protection (Next 16 renamed middleware to proxy).
 *
 * Runs on every non-asset request: hands the Supabase auth cookies to a
 * server client, lets it refresh an expiring token, and writes the refreshed
 * cookies back on the response. Unauthenticated visits to protected paths are
 * sent to /login with a return address.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasSupabaseEnv, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';

const PROTECTED = ['/account'];

export async function proxy(request: NextRequest) {
  if (!hasSupabaseEnv()) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Nothing may run between creating the client and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  if (!signedIn && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Machine endpoints (MCP, OAuth, discovery) carry bearer tokens, not cookies:
  // skip the session refresh there so every tool call does not pay for it.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/mcp|api/oauth|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|txt)$).*)'],
};
