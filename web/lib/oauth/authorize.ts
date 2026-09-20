import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isValidChallenge } from './pkce';
import { redirectMatches } from './redirect';
import { CLIENT_ID_RE } from './tokens';
import { SCOPES } from './origin';

/**
 * Validation for GET /oauth/authorize, shared by the page and its action.
 * A bad client or redirect_uri is shown on our page, never bounced to an
 * unverified URL; every other error is returned to the client's redirect_uri.
 */

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export interface ClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

export type AuthorizeCheck =
  | { ok: true; client: ClientRow; redirectUri: string; challenge: string; state: string | null; scope: string; resource: string | null }
  | { ok: false; fatal: true; error: string; description: string }
  | { ok: false; fatal: false; error: string; description: string; redirectUri: string; state: string | null };

export function pick(sp: Record<string, string | string[] | undefined>): AuthorizeParams {
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    response_type: one('response_type'),
    client_id: one('client_id'),
    redirect_uri: one('redirect_uri'),
    code_challenge: one('code_challenge'),
    code_challenge_method: one('code_challenge_method'),
    state: one('state'),
    scope: one('scope'),
    resource: one('resource'),
  };
}

export async function checkAuthorize(p: AuthorizeParams): Promise<AuthorizeCheck> {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, fatal: true, error: 'temporarily_unavailable', description: 'accounts are not configured on this deployment' };
  if (!p.client_id || !CLIENT_ID_RE.test(p.client_id)) return { ok: false, fatal: true, error: 'invalid_client', description: 'unknown client_id' };
  const r = await sb.from('vendx_oauth_clients').select('client_id, client_name, redirect_uris').eq('client_id', p.client_id).maybeSingle();
  const client = r.data as ClientRow | null;
  if (r.error || !client) return { ok: false, fatal: true, error: 'invalid_client', description: 'this client is not registered; run the install command again' };
  if (!p.redirect_uri || !redirectMatches(client.redirect_uris, p.redirect_uri)) {
    return { ok: false, fatal: true, error: 'invalid_request', description: 'redirect_uri is not registered for this client' };
  }
  const state = p.state ?? null;
  const bounce = (error: string, description: string): AuthorizeCheck => ({ ok: false, fatal: false, error, description, redirectUri: p.redirect_uri!, state });
  if (p.response_type !== 'code') return bounce('unsupported_response_type', 'only response_type=code is supported');
  if (!isValidChallenge(p.code_challenge)) return bounce('invalid_request', 'code_challenge (S256) is required');
  if ((p.code_challenge_method ?? 'S256') !== 'S256') return bounce('invalid_request', 'code_challenge_method must be S256');
  const requested = (p.scope ?? SCOPES.join(' ')).split(/\s+/).filter(Boolean);
  const unknown = requested.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (unknown.length) return bounce('invalid_scope', `unknown scope(s): ${unknown.join(' ')}`);
  return { ok: true, client, redirectUri: p.redirect_uri, challenge: p.code_challenge!, state, scope: requested.join(' '), resource: p.resource ?? null };
}

/** Append query params to an absolute URL or a site-relative path (a relative input stays relative). */
export function withParams(base: string, params: Record<string, string | null | undefined>): string {
  const relative = base.startsWith('/');
  const u = new URL(base, relative ? 'http://relative.invalid' : undefined);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return relative ? `${u.pathname}${u.search}` : u.toString();
}
