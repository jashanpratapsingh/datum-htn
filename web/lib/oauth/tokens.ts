import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque credentials, stored as sha256 hex only (same as vendx_agents.key_hash).
 *   vendx_sk_  agent API key (minted in Postgres by vendx_create_agent)
 *   vendx_at_  OAuth access token   (1 h)
 *   vendx_rt_  OAuth refresh token  (30 d, rotated on use)
 *   vendx_c_   OAuth client id
 * Codes are bare base64url(32) and live 10 minutes.
 */

export const ACCESS_TTL_SEC = 60 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
export const CODE_TTL_SEC = 10 * 60;

const B64U43 = '[A-Za-z0-9_-]{43}';
export const AGENT_KEY_RE = new RegExp(`^vendx_sk_${B64U43}$`);
export const ACCESS_RE = new RegExp(`^vendx_at_${B64U43}$`);
export const REFRESH_RE = new RegExp(`^vendx_rt_${B64U43}$`);
export const CODE_RE = new RegExp(`^${B64U43}$`);
export const CLIENT_ID_RE = /^vendx_c_[A-Za-z0-9_-]{22}$/;

export function randomB64u(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function newAccessToken(): string {
  return `vendx_at_${randomB64u(32)}`;
}
export function newRefreshToken(): string {
  return `vendx_rt_${randomB64u(32)}`;
}
export function newCode(): string {
  return randomB64u(32);
}
export function newClientId(): string {
  return `vendx_c_${randomB64u(16)}`;
}

export function hashToken(t: string): string {
  return createHash('sha256').update(t, 'utf8').digest('hex');
}

export type BearerKind = 'agent_key' | 'access' | 'refresh' | 'unknown';

export function classifyBearer(t: unknown): BearerKind {
  if (typeof t !== 'string') return 'unknown';
  if (AGENT_KEY_RE.test(t)) return 'agent_key';
  if (ACCESS_RE.test(t)) return 'access';
  if (REFRESH_RE.test(t)) return 'refresh';
  return 'unknown';
}

/** The token from an `Authorization: Bearer …` header, or null. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
