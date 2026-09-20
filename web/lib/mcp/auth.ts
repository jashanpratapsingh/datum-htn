import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { bearerFrom, classifyBearer, hashToken } from '@/lib/oauth/tokens';
import { MCP_PATH, siteOrigin, CORS_HEADERS } from '@/lib/oauth/origin';

/**
 * Who is calling /api/mcp. Two credentials are accepted:
 *   - an OAuth access token from our own authorization server (vendx_at_…),
 *     the path Claude Code / Codex / Cursor take after the browser consent;
 *   - a static agent API key (vendx_sk_…) minted on the account page, for
 *     clients configured with a bearer header instead of OAuth.
 * Both resolve to one agent and its owner. Auth failures are HTTP 401 with
 * the RFC 9728 hint that lets a client start the OAuth flow; they are never
 * tool errors.
 */

export interface McpIdentity {
  agentId: string;
  userId: string;
  agentName: string;
  clientId: string;
  scopes: string[];
  via: 'oauth' | 'agent_key';
}

export type AuthOutcome = { ok: true; identity: McpIdentity } | { ok: false; error: string; description: string };

interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  revoked_at: string | null;
}

export async function authenticateBearer(req: Request): Promise<AuthOutcome> {
  const token = bearerFrom(req.headers.get('authorization'));
  if (!token) return { ok: false, error: 'invalid_token', description: 'missing bearer token' };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, error: 'temporarily_unavailable', description: 'accounts are not configured on this deployment' };

  const kind = classifyBearer(token);
  if (kind === 'agent_key') {
    const r = await sb.from('vendx_agents').select('id, user_id, name, revoked_at').eq('key_hash', hashToken(token)).maybeSingle();
    const agent = r.data as AgentRow | null;
    if (r.error || !agent) return { ok: false, error: 'invalid_token', description: 'unknown agent key' };
    if (agent.revoked_at) return { ok: false, error: 'invalid_token', description: 'this agent key was revoked' };
    void sb.from('vendx_agents').update({ last_used_at: new Date().toISOString() }).eq('id', agent.id).then(() => undefined, () => undefined);
    return { ok: true, identity: { agentId: agent.id, userId: agent.user_id, agentName: agent.name, clientId: 'agent-key', scopes: ['vendx:read', 'vendx:buy'], via: 'agent_key' } };
  }

  if (kind === 'access') {
    const r = await sb
      .from('vendx_oauth_tokens')
      .select('id, client_id, agent_id, user_id, scope, expires_at, revoked_at, vendx_agents!inner(id, user_id, name, revoked_at)')
      .eq('token_hash', hashToken(token))
      .eq('kind', 'access')
      .maybeSingle();
    if (r.error) return { ok: false, error: 'temporarily_unavailable', description: r.error.message };
    const row = r.data as
      | { id: string; client_id: string; agent_id: string; user_id: string; scope: string | null; expires_at: string; revoked_at: string | null; vendx_agents: AgentRow | AgentRow[] }
      | null;
    if (!row) return { ok: false, error: 'invalid_token', description: 'unknown access token' };
    if (row.revoked_at) return { ok: false, error: 'invalid_token', description: 'access token revoked' };
    if (Date.parse(row.expires_at) < Date.now()) return { ok: false, error: 'invalid_token', description: 'access token expired' };
    const agent = Array.isArray(row.vendx_agents) ? row.vendx_agents[0] : row.vendx_agents;
    if (!agent) return { ok: false, error: 'invalid_token', description: 'agent no longer exists' };
    if (agent.revoked_at) return { ok: false, error: 'invalid_token', description: 'this connection was revoked on the dashboard' };
    void sb.from('vendx_oauth_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => undefined, () => undefined);
    return {
      ok: true,
      identity: { agentId: agent.id, userId: agent.user_id, agentName: agent.name, clientId: row.client_id, scopes: (row.scope ?? 'vendx:read vendx:buy').split(' '), via: 'oauth' },
    };
  }

  return { ok: false, error: 'invalid_token', description: 'unrecognised credential' };
}

/** 401 with the WWW-Authenticate hint clients need to discover our authorization server. */
export function unauthorized(req: Request, error: string, description: string): Response {
  const origin = siteOrigin(req);
  const status = error === 'temporarily_unavailable' ? 503 : 401;
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      'WWW-Authenticate': `Bearer realm="vendx", error="${error}", error_description="${description.replace(/"/g, "'")}", resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"`,
    },
  });
}
