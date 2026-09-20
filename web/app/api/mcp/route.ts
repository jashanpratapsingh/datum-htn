import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateBearer, unauthorized } from '@/lib/mcp/auth';
import { buildVendxServer } from '@/lib/mcp/server';
import { corsPreflight, siteOrigin } from '@/lib/oauth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One purchase is 402 (≤8 s) + devnet confirm (≤45 s) + settle (≤20 s) + redeem (≤8 s).
export const maxDuration = 120;

/**
 * The VENDX MCP server, Streamable HTTP, stateless: every POST is a complete
 * JSON-RPC exchange. Authentication is a bearer token — an OAuth access token
 * from /oauth/authorize or an agent API key — and a missing/invalid one gets
 * the 401 + WWW-Authenticate that lets Claude Code, Codex and Cursor discover
 * the authorization server and open the browser.
 */
export async function POST(req: Request) {
  const who = await authenticateBearer(req);
  if (!who.ok) return unauthorized(req, who.error, who.description);

  const server: McpServer = buildVendxServer(who.identity, siteOrigin(req));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req, {
      authInfo: {
        token: '',
        clientId: who.identity.clientId,
        scopes: who.identity.scopes,
        extra: { agentId: who.identity.agentId, userId: who.identity.userId, via: who.identity.via },
      },
    });
  } finally {
    // The response body has been produced (enableJsonResponse); nothing streams after this.
    void transport.close().catch(() => undefined);
  }
}

// Stateless: no standalone SSE stream to open and no session to delete.
export async function GET() {
  return new Response(JSON.stringify({ error: 'method_not_allowed', hint: 'POST JSON-RPC to this URL; see /connect' }), { status: 405, headers: { Allow: 'POST, OPTIONS', 'Content-Type': 'application/json' } });
}
export const DELETE = GET;

export async function OPTIONS() {
  return corsPreflight();
}
