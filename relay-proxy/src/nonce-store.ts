export interface NonceEntry {
  expiresAt: number;
  used: boolean;
  payTo: string;
  amountMicroUsdc: string;
}

const store = new Map<string, NonceEntry>();

// Prune expired entries every 60 s so the map doesn't grow unbounded.
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}, 60_000).unref();

export function issueNonce(nonce: string, entry: NonceEntry): void {
  store.set(nonce, entry);
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
  return { ok: true, entry };
}

/** Read-only lookup for the facilitator: the device consumes, /settle only checks. */
export function peekNonce(nonce: string): NonceEntry | undefined {
  return store.get(nonce);
}
