import { getSupabase, supabaseEnabled } from './supabase.js';

export interface NonceEntry {
  expiresAt: number;
  used: boolean;
  payTo: string;
  amountMicroUsdc: string;
  deviceId?: string;
  network?: string;
}

const store = new Map<string, NonceEntry>();
let hydrated = false;

// Prune expired entries every 60 s so the map doesn't grow unbounded.
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}, 60_000).unref();

/**
 * Load outstanding nonces from Supabase into memory.
 * Safe to call repeatedly; only the first call hits the network.
 */
export async function hydrateNonces(): Promise<void> {
  if (hydrated || !supabaseEnabled()) return;
  hydrated = true;
  const db = getSupabase();
  if (!db) return;
  const now = Math.floor(Date.now() / 1000);
  const { data, error } = await db
    .from('vendx_nonces')
    .select('nonce, expires_at, used_at, pay_to, amount, device_id, network')
    .gt('expires_at', now)
    .limit(5000);
  if (error) {
    console.warn(`[nonce-store] hydrate failed: ${error.message}`);
    return;
  }
  for (const row of data ?? []) {
    store.set(row.nonce as string, {
      expiresAt: Number(row.expires_at),
      used: row.used_at != null,
      payTo: String(row.pay_to),
      amountMicroUsdc: String(row.amount),
      deviceId: row.device_id != null ? String(row.device_id) : undefined,
      network: row.network != null ? String(row.network) : undefined,
    });
  }
  console.log(`[nonce-store] hydrated ${store.size} nonces from Supabase`);
}

export function issueNonce(nonce: string, entry: NonceEntry): void {
  store.set(nonce, entry);
  const db = getSupabase();
  if (!db) return;
  void db
    .from('vendx_nonces')
    .upsert({
      nonce,
      expires_at: entry.expiresAt,
      used_at: null,
      device_id: entry.deviceId ?? 'relay',
      network: entry.network ?? 'solana-devnet',
      pay_to: entry.payTo,
      amount: entry.amountMicroUsdc,
    })
    .then(({ error }) => {
      if (error) console.warn(`[nonce-store] persist issue failed: ${error.message}`);
    });
}

export type ConsumeResult =
  | { ok: true; entry: NonceEntry }
  | { ok: false; reason: 'nonce_unknown' | 'nonce_replayed' | 'nonce_expired' };

export function consumeNonce(nonce: string): ConsumeResult {
  const entry = store.get(nonce);
  if (!entry) return { ok: false, reason: 'nonce_unknown' };
  if (entry.used) return { ok: false, reason: 'nonce_replayed' };
  const now = Math.floor(Date.now() / 1000);
  if (entry.expiresAt < now) return { ok: false, reason: 'nonce_expired' };
  entry.used = true;

  const db = getSupabase();
  if (db) {
    void db
      .from('vendx_nonces')
      .update({ used_at: now })
      .eq('nonce', nonce)
      .then(({ error }) => {
        if (error) console.warn(`[nonce-store] persist consume failed: ${error.message}`);
      });
  }

  return { ok: true, entry };
}
