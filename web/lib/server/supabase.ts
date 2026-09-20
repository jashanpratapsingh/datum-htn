/**
 * Server-side Supabase client for the wallet accounts table.
 *
 * Uses the service key, so it bypasses RLS and must never reach the browser.
 * Every helper degrades to `null` when Supabase is unconfigured or unreachable:
 * login has to work in a demo with no database behind it, so callers report
 * `warning: 'accounts_unavailable'` instead of failing.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AccountRow {
  wallet: string;
  first_seen: string;
  last_seen: string;
  login_count: number;
  last_domain: string | null;
  last_method: string | null;
}

let client: SupabaseClient | null | undefined;
let warned = false;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    if (!warned) {
      warned = true;
      console.warn('[web] SUPABASE_URL / SUPABASE_SERVICE_KEY unset: accounts are not persisted');
    }
    client = null;
    return null;
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function asRow(data: unknown): AccountRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' && typeof (row as AccountRow).wallet === 'string'
    ? (row as AccountRow)
    : null;
}

/** Insert-or-touch on login. Returns the row, or null when Supabase is unavailable. */
export async function touchAccount(
  wallet: string,
  domain: string,
  method: 'signIn' | 'signMessage',
): Promise<AccountRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.rpc('vendx_touch_account', {
      p_wallet: wallet,
      p_domain: domain,
      p_method: method,
    });
    if (error) {
      console.warn(`[web] vendx_touch_account failed: ${error.message}`);
      return null;
    }
    return asRow(data);
  } catch (e) {
    console.warn(`[web] supabase unreachable: ${(e as Error).message}`);
    return null;
  }
}

export async function getAccount(wallet: string): Promise<AccountRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from('vendx_accounts').select('*').eq('wallet', wallet).maybeSingle();
    if (error) {
      console.warn(`[web] vendx_accounts read failed: ${error.message}`);
      return null;
    }
    return asRow(data);
  } catch (e) {
    console.warn(`[web] supabase unreachable: ${(e as Error).message}`);
    return null;
  }
}
