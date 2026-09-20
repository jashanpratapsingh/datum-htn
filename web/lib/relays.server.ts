import 'server-only';
import { getRelay, type RelayInfo } from './relays';
import { dbRelays } from './db';

/**
 * `?relay=<key>` may name an env-configured relay or one that only exists in
 * the Supabase directory (another vendor's relay somewhere in the world).
 */
export async function resolveRelay(key: string | null | undefined): Promise<RelayInfo | undefined> {
  if (!key) return undefined;
  const env = getRelay(key);
  if (env) return env;
  const all = await dbRelays();
  const hit = all.find((r) => r.key === key);
  return hit && hit.url ? hit : undefined;
}
