import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. Bypasses RLS; never reaches the browser.
 *
 * Env: `SUPABASE_URL` (or the public URL) and `SUPABASE_SERVICE_KEY` — the
 * name the Phantom login shipped with and the one Vercel already holds.
 * `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` are accepted as aliases
 * so a relay.env copied into web works too.
 */
let client: SupabaseClient | null | undefined;
let warned = false;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    if (!warned) {
      warned = true;
      console.warn('[web] SUPABASE_URL / SUPABASE_SERVICE_KEY unset: server-side account features are off');
    }
    client = null;
    return null;
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Like getSupabaseAdmin() but throws, for handlers that cannot work without it. */
export function requireSupabaseAdmin(): SupabaseClient {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error('supabase_admin_unconfigured');
  return sb;
}
