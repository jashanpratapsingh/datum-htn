'use server';

import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase/server';
import { requireSupabaseAdmin } from '@/lib/supabase/admin';
import { checkAuthorize, withParams, type AuthorizeParams } from '@/lib/oauth/authorize';
import { CODE_TTL_SEC, hashToken, newCode } from '@/lib/oauth/tokens';
import { ensureAgentWallet } from '@/lib/mcp/wallet';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function usdToMicro(raw: string, fallback: bigint): bigint | null {
  const t = raw.trim();
  if (t === '') return fallback;
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
}

export interface ConsentState {
  error?: string;
}

/**
 * The owner approved: pick or create the agent, give it a wallet, mint the
 * one-time code, and hand off to the "fund your agent" page which carries
 * the client's redirect. Every OAuth parameter is re-validated here; the form
 * fields are not trusted.
 */
export async function approve(_prev: ConsentState, formData: FormData): Promise<ConsentState> {
  const user = await getSessionUser();
  if (!user) return { error: 'Your session ended. Sign in again.' };

  const p: AuthorizeParams = {
    response_type: 'code',
    client_id: String(formData.get('client_id') ?? ''),
    redirect_uri: String(formData.get('redirect_uri') ?? ''),
    code_challenge: String(formData.get('code_challenge') ?? ''),
    code_challenge_method: 'S256',
    state: (formData.get('state') as string | null) || undefined,
    scope: (formData.get('scope') as string | null) || undefined,
    resource: (formData.get('resource') as string | null) || undefined,
  };
  const check = await checkAuthorize(p);
  if (!check.ok) return { error: check.description };

  const sb = requireSupabaseAdmin();
  const choice = String(formData.get('agent') ?? 'new');
  const dailyCap = usdToMicro(String(formData.get('daily_cap') ?? ''), 500_000n);
  const perRequest = usdToMicro(String(formData.get('per_request_cap') ?? ''), 100_000n);
  if (dailyCap === null || perRequest === null) return { error: 'Caps must be USDC amounts like 0.50.' };
  if (perRequest <= 0n) return { error: 'The per-request cap must be above zero.' };
  if (dailyCap > 0n && perRequest > dailyCap) return { error: 'The per-request cap cannot exceed the daily cap.' };

  let agentId: string;
  if (choice === 'new') {
    const name = String(formData.get('name') ?? '').trim() || (check.client.client_name ?? 'MCP agent');
    if (!NAME_RE.test(name)) return { error: 'Agent name: 1–64 letters, digits, spaces, dots, dashes or underscores.' };
    const created = await sb.rpc('vendx_create_agent_oauth', {
      p_user_id: user.id,
      p_name: name,
      p_client_name: check.client.client_name,
      p_daily_cap: dailyCap === 0n ? null : Number(dailyCap),
      p_per_request_cap: Number(perRequest),
    });
    if (created.error || !created.data) return { error: `Could not create the agent: ${created.error?.message ?? 'no id returned'}` };
    agentId = String(created.data);
  } else {
    if (!UUID_RE.test(choice)) return { error: 'Pick an agent.' };
    const own = await sb.from('vendx_agents').select('id, revoked_at').eq('id', choice).eq('user_id', user.id).maybeSingle();
    const row = own.data as { id: string; revoked_at: string | null } | null;
    if (!row || row.revoked_at) return { error: 'That agent is not yours or was revoked.' };
    agentId = row.id;
    await sb
      .from('vendx_agents')
      .update({ daily_cap_micro_usdc: dailyCap === 0n ? null : Number(dailyCap), per_request_cap_micro_usdc: Number(perRequest), client_name: check.client.client_name })
      .eq('id', agentId);
  }

  const wallet = await ensureAgentWallet(agentId);

  const code = newCode();
  const ins = await sb.from('vendx_oauth_codes').insert({
    code_hash: hashToken(code),
    client_id: check.client.client_id,
    user_id: user.id,
    agent_id: agentId,
    redirect_uri: check.redirectUri,
    code_challenge: check.challenge,
    code_challenge_method: 'S256',
    scope: check.scope,
    resource: check.resource,
    expires_at: new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString(),
  });
  if (ins.error) return { error: `Could not issue the code: ${ins.error.message}` };

  const back = withParams(check.redirectUri, { code, state: check.state });
  redirect(
    withParams('/oauth/authorize/done', {
      agent: agentId,
      wallet: wallet.pubkey,
      client: check.client.client_name ?? check.client.client_id,
      back,
    }),
  );
}

export async function deny(formData: FormData): Promise<void> {
  const p: AuthorizeParams = {
    response_type: 'code',
    client_id: String(formData.get('client_id') ?? ''),
    redirect_uri: String(formData.get('redirect_uri') ?? ''),
    code_challenge: String(formData.get('code_challenge') ?? ''),
    code_challenge_method: 'S256',
    state: (formData.get('state') as string | null) || undefined,
  };
  const check = await checkAuthorize(p);
  if (!check.ok && check.fatal) redirect('/connect');
  const redirectUri = check.ok ? check.redirectUri : check.redirectUri;
  const state = check.ok ? check.state : check.state;
  redirect(withParams(redirectUri, { error: 'access_denied', error_description: 'the owner declined', state }));
}
