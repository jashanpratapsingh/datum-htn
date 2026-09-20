import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { hasSupabaseEnv, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

/**
 * Per-request client bound to the caller's session cookies. Use in server
 * components, Server Actions and Route Handlers. Cookies can only be written
 * from Actions and Route Handlers; on a page the write is a no-op and
 * proxy.ts is what actually refreshes the session.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component; proxy.ts handles the refresh.
        }
      },
    },
  });
}

/** The signed-in user, verified against Supabase (not just decoded), or null. */
export async function getSessionUser(): Promise<User | null> {
  if (!hasSupabaseEnv()) return null;
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
