/**
 * Install snippets for the three coding agents. Pure functions so the connect
 * page (server) and the account page (per agent, with a key) share them.
 */
export interface Snippet {
  client: 'claude' | 'codex' | 'cursor';
  title: string;
  blocks: Array<{ label: string; text: string; href?: string }>;
  note: string;
}

export function mcpUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

export function cursorDeepLink(origin: string, bearer?: string): string {
  const config = bearer ? { url: mcpUrl(origin), headers: { Authorization: `Bearer ${bearer}` } } : { url: mcpUrl(origin) };
  const b64 = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=vendx&config=${encodeURIComponent(b64)}`;
}

/** OAuth path: the client opens the browser, the owner approves on this site. */
export function oauthSnippets(origin: string): Snippet[] {
  const url = mcpUrl(origin);
  return [
    {
      client: 'claude',
      title: 'Claude Code',
      blocks: [
        { label: 'add the server (user scope: every project)', text: `claude mcp add --transport http --scope user vendx ${url}` },
        { label: 'then, inside Claude Code', text: '/mcp   → pick vendx → Authenticate (opens this site)' },
      ],
      note: 'Claude Code discovers our authorization server from the 401, registers itself, opens the browser for consent and stores the token. `claude mcp login vendx` re-runs it.',
    },
    {
      client: 'codex',
      title: 'Codex CLI',
      blocks: [
        { label: 'add and sign in', text: `codex mcp add vendx --url ${url}\ncodex mcp login vendx` },
      ],
      note: 'Codex uses the same OAuth flow. Restart the session after signing in.',
    },
    {
      client: 'cursor',
      title: 'Cursor',
      blocks: [
        { label: 'one-click', text: cursorDeepLink(origin), href: cursorDeepLink(origin) },
        { label: 'or .cursor/mcp.json', text: JSON.stringify({ mcpServers: { vendx: { url } } }, null, 2) },
      ],
      note: 'Cursor prompts to install, then shows a Sign in button for the server; approve on this site.',
    },
  ];
}

/** Static-key path: an agent API key as a bearer header (no browser round-trip). */
export function keySnippets(origin: string, key: string): Snippet[] {
  const url = mcpUrl(origin);
  return [
    {
      client: 'claude',
      title: 'Claude Code',
      blocks: [{ label: 'add the server with the key', text: `claude mcp add --transport http --scope user vendx ${url} --header "Authorization: Bearer ${key}"` }],
      note: 'No browser step: the key is the credential. Revoke it from this page to cut the agent off.',
    },
    {
      client: 'codex',
      title: 'Codex CLI',
      blocks: [{ label: 'keep the key in an env var, not in config.toml', text: `export VENDX_API_KEY=${key}\ncodex mcp add vendx --url ${url} --bearer-token-env-var VENDX_API_KEY` }],
      note: 'Codex reads the bearer token from VENDX_API_KEY at start-up.',
    },
    {
      client: 'cursor',
      title: 'Cursor',
      blocks: [
        { label: 'one-click (key embedded)', text: cursorDeepLink(origin, key), href: cursorDeepLink(origin, key) },
        { label: 'or .cursor/mcp.json', text: JSON.stringify({ mcpServers: { vendx: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2) },
      ],
      note: 'Cursor sends the header on every request.',
    },
  ];
}
