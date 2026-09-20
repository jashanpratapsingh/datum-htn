import { getRelayIdentity } from '../identity.js';
import { MemoryStore } from './memory.js';
import { SupabaseStore } from './supabase.js';
import type { Store } from './types.js';

export * from './types.js';
export { MemoryStore } from './memory.js';
export { SupabaseStore } from './supabase.js';

export type Persistence = Store['kind'];

/**
 * Supabase when SUPABASE_URL and SUPABASE_SECRET_KEY (or the legacy
 * SUPABASE_SERVICE_ROLE_KEY) are both set; otherwise memory, loudly.
 * Called lazily by createRelayServer, never at import time, so the tests and
 * scripts/demo.mjs stay on memory without any environment.
 */
export function createStoreFromEnv(env: NodeJS.ProcessEnv = process.env, relayId?: string): Store {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return new SupabaseStore(url, key, relayId ?? getRelayIdentity().relayId);
  if (url || key) {
    console.warn('[relay-proxy] SUPABASE_URL and SUPABASE_SECRET_KEY must both be set; using the MEMORY store');
  }
  console.warn(
    '[relay-proxy] persistence: MEMORY — nonces, signatures and sales are lost on restart, ' +
      'and agent API keys are not recognised (set SUPABASE_URL + SUPABASE_SECRET_KEY)',
  );
  return new MemoryStore();
}
