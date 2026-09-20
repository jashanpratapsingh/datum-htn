import { corsPreflight, jsonResponse, SCOPES, siteOrigin } from '@/lib/oauth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RFC 8414 Authorization Server Metadata. The site is its own authorization server. */
export async function GET(req: Request) {
  const origin = siteOrigin(req);
  return jsonResponse({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES],
    service_documentation: `${origin}/connect`,
  });
}

export async function OPTIONS() {
  return corsPreflight();
}
