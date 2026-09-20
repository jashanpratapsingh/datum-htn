import { corsPreflight, jsonResponse, MCP_PATH, SCOPES, siteOrigin } from '@/lib/oauth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 9728 Protected Resource Metadata for the MCP server. Served at both
 * /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp
 * through next.config rewrites; Claude Code tries the path-suffixed one first.
 */
export async function GET(req: Request) {
  const origin = siteOrigin(req);
  return jsonResponse({
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'VENDX marketplace',
    resource_documentation: `${origin}/connect`,
  });
}

export async function OPTIONS() {
  return corsPreflight();
}
