import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@vendx/protocol'],
  // OAuth discovery for the MCP server (RFC 9728 / RFC 8414). Claude Code asks
  // for the path-suffixed resource metadata first, then the root one.
  async rewrites() {
    return [
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/oauth/prm' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/prm' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/as-metadata' },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'cdn.21st.dev' },
    ],
  },
};

export default nextConfig;
