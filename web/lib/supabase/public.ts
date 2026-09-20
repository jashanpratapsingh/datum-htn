import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hasSupabaseEnv, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

let _client: SupabaseClient | null = null;

/**
 * Anonymous, cookie-less client for RLS-public reads (directory, public
 * sales view). Never holds a session, so it is safe to share across requests.
 */
export function createSupabasePublic(): SupabaseClient | null {
  if (!hasSupabaseEnv()) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}
