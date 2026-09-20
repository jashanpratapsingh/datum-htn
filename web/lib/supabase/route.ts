import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

/**
 * Cookie-bound Supabase client for Route Handlers that must WRITE session
 * cookies (login, logout). Reads cookies from the request, writes them onto
 * the response you pass in — return that response.
 */
export function createSupabaseRoute(req: NextRequest, res: NextResponse) {
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) res.cookies.set(name, value, options);
      },
    },
  });
}
