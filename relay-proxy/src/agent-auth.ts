/**
 * Buyer attribution. Payment is the access control; a key only says *who*
 * bought, so the website can show each account its own purchases.
 *
 * Two forms:
 *   - `X-Vendx-Agent-Key: vendx_sk_…` — an API key minted on the website for a
 *     registered agent (MCP server, agent-buyer CLI). Looked up by sha256.
 *   - `X-Vendx-Web-Secret` + `X-Vendx-User-Id` — the website's own server
 *     buying on behalf of a signed-in user. The secret is shared out of band
 *     (VENDX_WEB_SECRET on both sides) and never reaches a browser.
 *
 * A dedicated header rather than `Authorization: Bearer`: the x402 flow keeps
 * its credentials in X-PAYMENT* headers already, and this one is optional.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AgentRef, Store } from './store/types.js';

export const AGENT_KEY_HEADER = 'x-vendx-agent-key';
export const WEB_SECRET_HEADER = 'x-vendx-web-secret';
export const WEB_USER_HEADER = 'x-vendx-user-id';
/** With the web secret: the agent (vendx_agents.id) the website is buying for, e.g. an MCP connection. */
export const WEB_AGENT_HEADER = 'x-vendx-agent-id';

/** 'vendx_sk_' + base64url(32 bytes) = 52 chars. */
export const AGENT_KEY_RE = /^vendx_sk_[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hashAgentKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export type AgentResolution =
  | { status: 'anonymous' }
  | { status: 'malformed' }
  | { status: 'unknown' }
  | { status: 'revoked'; agent: AgentRef }
  | { status: 'ok'; agent: AgentRef }
  | { status: 'web'; userId: string; agentId?: string };

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === 'string' && v.length > 0 ? v.trim() : undefined;
}

function secretMatches(given: string): boolean {
  const expected = process.env.VENDX_WEB_SECRET;
  if (!expected) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function resolveAgent(req: IncomingMessage, store: Store): Promise<AgentResolution> {
  const key = header(req, AGENT_KEY_HEADER);
  if (key) {
    if (!AGENT_KEY_RE.test(key)) return { status: 'malformed' };
    const agent = await store.lookupAgentByKeyHash(hashAgentKey(key));
    if (!agent) return { status: 'unknown' };
    if (agent.revokedAt) return { status: 'revoked', agent };
    return { status: 'ok', agent };
  }
  const secret = header(req, WEB_SECRET_HEADER);
  const userId = header(req, WEB_USER_HEADER);
  if (secret && userId && UUID_RE.test(userId) && secretMatches(secret)) {
    const agentId = header(req, WEB_AGENT_HEADER);
    return agentId && UUID_RE.test(agentId) ? { status: 'web', userId, agentId } : { status: 'web', userId };
  }
  return { status: 'anonymous' };
}
