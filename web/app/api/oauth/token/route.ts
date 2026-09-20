import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { verifyPkce } from '@/lib/oauth/pkce';
import { redirectMatches } from '@/lib/oauth/redirect';
import {
  ACCESS_TTL_SEC,
  CODE_RE,
  REFRESH_RE,
  REFRESH_TTL_SEC,
  CLIENT_ID_RE,
  hashToken,
  newAccessToken,
  newRefreshToken,
} from '@/lib/oauth/tokens';
import { corsPreflight, jsonResponse, oauthError } from '@/lib/oauth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 6749 token endpoint for public clients.
 *   grant_type=authorization_code  code + code_verifier (PKCE S256) + redirect_uri + client_id
 *   grant_type=refresh_token       refresh_token + client_id
 * Tokens are opaque; only sha256 hashes are stored. Refresh tokens rotate on
 * every use; presenting an already-rotated one revokes the whole family.
 */

async function readParams(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string') as [string, string][]);
  }
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}

interface CodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  agent_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  expires_at: string;
  used_at: string | null;
}
interface TokenRow {
  id: string;
  client_id: string;
  user_id: string;
  agent_id: string;
  scope: string | null;
  family_id: string;
  expires_at: string;
  revoked_at: string | null;
}

async function issuePair(
  sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  base: { client_id: string; user_id: string; agent_id: string; scope: string | null; family_id: string },
) {
  const access = newAccessToken();
  const refresh = newRefreshToken();
  const now = Date.now();
  const ins = await sb.from('vendx_oauth_tokens').insert([
    { ...base, kind: 'access', token_hash: hashToken(access), expires_at: new Date(now + ACCESS_TTL_SEC * 1000).toISOString() },
    { ...base, kind: 'refresh', token_hash: hashToken(refresh), expires_at: new Date(now + REFRESH_TTL_SEC * 1000).toISOString() },
  ]);
  if (ins.error) throw new Error(ins.error.message);
  void sb.from('vendx_oauth_clients').update({ last_used_at: new Date().toISOString() }).eq('client_id', base.client_id).then(() => undefined, () => undefined);
  return jsonResponse({
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope: base.scope ?? undefined,
  });
}

export async function POST(req: Request) {
  const sb = getSupabaseAdmin();
  if (!sb) return oauthError('temporarily_unavailable', 'accounts are not configured on this deployment', 503);
  const p = await readParams(req);
  const clientId = p.client_id ?? '';
  if (!CLIENT_ID_RE.test(clientId)) return oauthError('invalid_client', 'client_id is missing or malformed', 401);

  try {
    if (p.grant_type === 'authorization_code') {
      const code = p.code ?? '';
      if (!CODE_RE.test(code)) return oauthError('invalid_grant', 'code is malformed');
      // Consume atomically: the first exchange wins, a replay sees 0 rows.
      const consumed = await sb
        .from('vendx_oauth_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('code_hash', hashToken(code))
        .is('used_at', null)
        .select('code_hash, client_id, user_id, agent_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used_at')
        .maybeSingle();
      if (consumed.error) return oauthError('server_error', consumed.error.message, 500);
      const row = consumed.data as CodeRow | null;
      if (!row) return oauthError('invalid_grant', 'code is unknown or already used');
      if (row.client_id !== clientId) return oauthError('invalid_grant', 'code was issued to another client');
      if (Date.parse(row.expires_at) < Date.now()) return oauthError('invalid_grant', 'code expired');
      if (p.redirect_uri && p.redirect_uri !== row.redirect_uri && !redirectMatches([row.redirect_uri], p.redirect_uri)) {
        return oauthError('invalid_grant', 'redirect_uri does not match the authorization request');
      }
      if (!verifyPkce(p.code_verifier, row.code_challenge, row.code_challenge_method)) return oauthError('invalid_grant', 'PKCE verification failed');

      return await issuePair(sb, {
        client_id: row.client_id,
        user_id: row.user_id,
        agent_id: row.agent_id,
        scope: row.scope,
        family_id: crypto.randomUUID(),
      });
    }

    if (p.grant_type === 'refresh_token') {
      const rt = p.refresh_token ?? '';
      if (!REFRESH_RE.test(rt)) return oauthError('invalid_grant', 'refresh_token is malformed');
      const found = await sb
        .from('vendx_oauth_tokens')
        .select('id, client_id, user_id, agent_id, scope, family_id, expires_at, revoked_at')
        .eq('token_hash', hashToken(rt))
        .eq('kind', 'refresh')
        .maybeSingle();
      if (found.error) return oauthError('server_error', found.error.message, 500);
      const row = found.data as TokenRow | null;
      if (!row) return oauthError('invalid_grant', 'refresh_token is unknown');
      if (row.client_id !== clientId) return oauthError('invalid_grant', 'refresh_token belongs to another client');
      if (row.revoked_at) {
        // Rotated token presented again: someone replayed it. Kill the family.
        await sb.from('vendx_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('family_id', row.family_id).is('revoked_at', null);
        return oauthError('invalid_grant', 'refresh_token was already used; the session has been revoked');
      }
      if (Date.parse(row.expires_at) < Date.now()) return oauthError('invalid_grant', 'refresh_token expired');
      const agent = await sb.from('vendx_agents').select('revoked_at').eq('id', row.agent_id).maybeSingle();
      if ((agent.data as { revoked_at: string | null } | null)?.revoked_at) return oauthError('invalid_grant', 'this connection was revoked on the dashboard');

      // Rotate: retire the old refresh token (and the access tokens issued beside it).
      await sb.from('vendx_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('family_id', row.family_id).is('revoked_at', null);
      return await issuePair(sb, { client_id: row.client_id, user_id: row.user_id, agent_id: row.agent_id, scope: row.scope, family_id: row.family_id });
    }

    return oauthError('unsupported_grant_type', 'use authorization_code or refresh_token');
  } catch (e) {
    return oauthError('server_error', e instanceof Error ? e.message : String(e), 500);
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
