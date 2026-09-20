'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export interface CreateAgentState {
  error?: string;
  /** Present exactly once, right after creation. Never stored anywhere on the web side. */
  key?: string;
  agent?: { id: string; name: string; keyPrefix: string };
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

export async function createAgent(_prev: CreateAgentState, formData: FormData): Promise<CreateAgentState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!NAME_RE.test(name)) return { error: 'Name: 1–64 letters, digits, spaces, dots, dashes or underscores.' };

  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Sign in first.' };

  // The key is minted in the database (vendx_create_agent): only its sha256 is
  // stored; the plaintext comes back once, to this response, and nowhere else.
  const { data, error } = await supabase.rpc('vendx_create_agent', { p_name: name });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; name: string; key: string; key_prefix: string } | undefined;
  if (!row?.key) return { error: 'The database returned no key.' };

  revalidatePath('/account');
  return { key: row.key, agent: { id: row.id, name: row.name, keyPrefix: row.key_prefix } };
}

export async function revokeAgent(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const supabase = await createSupabaseServer();
  // RLS restricts this to the caller's own rows; the column grant to revoked_at only.
  const { data } = await supabase.from('vendx_agents').update({ revoked_at: new Date().toISOString() }).eq('id', id).select('id');
  // Cut off every OAuth session of that agent too (service role: tokens are not client-writable).
  if (Array.isArray(data) && data.length) {
    const admin = getSupabaseAdmin();
    if (admin) await admin.from('vendx_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('agent_id', id).is('revoked_at', null);
  }
  revalidatePath('/account');
}

function usdToMicro(raw: string): bigint | null {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
}

/** Owner edits the caps; RLS + the column grant limit it to their own agents' cap columns. */
export async function updateCaps(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const per = usdToMicro(String(formData.get('per_request_cap') ?? ''));
  const daily = usdToMicro(String(formData.get('daily_cap') ?? ''));
  if (per === null || daily === null || per <= 0n) return;
  const supabase = await createSupabaseServer();
  await supabase
    .from('vendx_agents')
    .update({ per_request_cap_micro_usdc: Number(per), daily_cap_micro_usdc: daily === 0n ? null : Number(daily) })
    .eq('id', id);
  revalidatePath('/account');
}
