import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { validateRedirectUris } from '@/lib/oauth/redirect';
import { newClientId } from '@/lib/oauth/tokens';
import { corsPreflight, jsonResponse, oauthError } from '@/lib/oauth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 7591 dynamic client registration. Public clients only (PKCE, no
 * secret): Claude Code, Codex and Cursor all register themselves this way
 * before the first browser round-trip. Clients unused for 30 days are pruned
 * opportunistically so the table does not grow with every laptop that tried.
 */
export async function POST(req: Request) {
  const sb = getSupabaseAdmin();
  if (!sb) return oauthError('temporarily_unavailable', 'accounts are not configured on this deployment', 503);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return oauthError('invalid_client_metadata', 'body must be JSON');

  const uris = validateRedirectUris(body.redirect_uris);
  if (!uris.ok) return oauthError('invalid_redirect_uri', uris.error);

  const authMethod = body.token_endpoint_auth_method ?? 'none';
  if (authMethod !== 'none') return oauthError('invalid_client_metadata', 'only public clients (token_endpoint_auth_method "none") are supported');

  const grants = Array.isArray(body.grant_types) ? (body.grant_types as unknown[]).filter((g): g is string => typeof g === 'string') : ['authorization_code', 'refresh_token'];
  if (!grants.includes('authorization_code')) return oauthError('invalid_client_metadata', 'grant_types must include authorization_code');
  const responseTypes = Array.isArray(body.response_types) ? (body.response_types as unknown[]) : ['code'];
  if (!responseTypes.includes('code')) return oauthError('invalid_client_metadata', 'response_types must include code');

  const clientName = typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : null;
  const softwareId = typeof body.software_id === 'string' ? body.software_id.slice(0, 120) : null;
  const clientId = newClientId();

  const ins = await sb.from('vendx_oauth_clients').insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: uris.uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    software_id: softwareId,
  });
  if (ins.error) return oauthError('server_error', `could not store the client: ${ins.error.message}`, 500);

  // Cheap housekeeping: drop registrations nobody used in 30 days.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  void sb.from('vendx_oauth_clients').delete().is('last_used_at', null).lt('created_at', cutoff).then(() => undefined, () => undefined);

  return jsonResponse(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName ?? undefined,
      redirect_uris: uris.uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
  );
}

export async function OPTIONS() {
  return corsPreflight();
}
