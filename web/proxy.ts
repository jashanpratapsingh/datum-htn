/**
 * Session refresh and route protection (Next 16 renamed middleware to proxy).
 *
 * Runs on every non-asset request: hands the Supabase auth cookies to a
 * server client, lets it refresh an expiring token, and writes the refreshed
 * cookies back on the response. A request that carries a valid Phantom
 * session cookie but no Supabase session gets one opened here, so a wallet
 * login is a full login everywhere (account, purchases, OAuth consent).
 * Unauthenticated visits to protected paths are sent to /login with a return
 * address.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasSupabaseEnv, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';
import { SESSION_COOKIE, sessionFromCookie } from '@/lib/server/session';
import { openWalletSessionWith } from '@/lib/server/wallet-user';

const PROTECTED = ['/account'];

// A bridge that just failed for a wallet is not retried on every request:
// the wallet-only viewer answers meanwhile and this holds the retry off.
const BRIDGE_RETRY_MS = 60_000;
const bridgeFailedUntil = new Map<string, number>();

export async function proxy(request: NextRequest) {
  if (!hasSupabaseEnv()) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  // Cookies written during this request go onto the response for the browser
  // AND onto the forwarded request, so the server components rendering right
  // after this see the session in the same round trip.
  const cookieJar = {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
      for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
    },
  };
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { cookies: cookieJar });

  // Nothing may run between creating the client and this call.
  const { data } = await supabase.auth.getClaims();
  let signedIn = Boolean(data?.claims);

  // A wallet that signed in with Phantom but has no Supabase session yet: the
  // cookie predates the bridge, the Supabase session expired first, or the
  // login ran while Supabase was down. Bridge it now; failure only means the
  // wallet-only fallback in lib/auth/viewer.ts answers instead.
  const wallet = signedIn ? null : sessionFromCookie(request.cookies.get(SESSION_COOKIE)?.value);
  if (wallet && (bridgeFailedUntil.get(wallet.w) ?? 0) <= Date.now()) {
    const bridged = await openWalletSessionWith(wallet.w, cookieJar);
    if (bridged) {
      signedIn = true;
      bridgeFailedUntil.delete(wallet.w);
    } else {
      bridgeFailedUntil.set(wallet.w, Date.now() + BRIDGE_RETRY_MS);
    }
  }

  const { pathname } = request.nextUrl;
  if (!signedIn && !wallet && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
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
