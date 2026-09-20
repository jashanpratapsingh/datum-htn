/**
 * The public origin this deployment answers on. OAuth metadata, the protected
 * resource identifier and the install snippets all need one canonical value.
 * VENDX_SITE_URL pins it (set it once the site has its own domain); otherwise
 * it is derived from the request the way /api/auth/nonce already does.
 */
export function siteOrigin(req: Request): string {
  const pinned = process.env.VENDX_SITE_URL?.replace(/\/+$/, '');
  if (pinned) return pinned;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export const MCP_PATH = '/api/mcp';
export const SCOPES = ['vendx:read', 'vendx:buy'] as const;

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '600',
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS, ...extra },
  });
}

/** RFC 6749 §5.2 style error body. */
export function oauthError(error: string, description: string, status = 400): Response {
  return jsonResponse({ error, error_description: description }, status);
}
