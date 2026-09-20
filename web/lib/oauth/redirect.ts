/**
 * Redirect URI rules for dynamically registered clients.
 *
 * Coding agents register loopback URIs (Claude Code: http://localhost:<port>/callback)
 * and RFC 8252 §7.3 says the port may vary between registration and use, so a
 * loopback match ignores the port. Everything else is exact.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopback(u: URL): boolean {
  return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname === '::1' ? '[::1]' : u.hostname);
}

export function parseRedirectUri(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.hash) return null;
  if (u.protocol === 'https:') return u;
  if (isLoopback(u)) return u;
  return null;
}

/** Validate a registration's redirect_uris; returns the normalised list or an error string. */
export function validateRedirectUris(list: unknown): { ok: true; uris: string[] } | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'redirect_uris must be a non-empty array' };
  if (list.length > 10) return { ok: false, error: 'at most 10 redirect_uris' };
  const uris: string[] = [];
  for (const raw of list) {
    const u = parseRedirectUri(raw);
    if (!u) return { ok: false, error: `redirect_uri must be https:// or a loopback http:// URL without a fragment: ${String(raw).slice(0, 80)}` };
    uris.push(u.toString());
  }
  return { ok: true, uris };
}

/** Does `given` match one of the registered URIs (loopback: any port)? */
export function redirectMatches(registered: readonly string[], given: string): boolean {
  const g = parseRedirectUri(given);
  if (!g) return false;
  for (const r of registered) {
    let ru: URL;
    try {
      ru = new URL(r);
    } catch {
      continue;
    }
    if (ru.toString() === g.toString()) return true;
    if (isLoopback(ru) && isLoopback(g) && ru.hostname === g.hostname && ru.pathname === g.pathname && ru.search === g.search) return true;
  }
  return false;
}
