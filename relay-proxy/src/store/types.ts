/**
 * The relay's durable state, behind one interface.
 *
 * Everything here used to live in process memory (a nonce Map, a Set of used
 * transaction signatures, an array of sales), so a restart forgot every
 * receipt it had issued and let a redeemed receipt be replayed. `MemoryStore`
 * keeps that behaviour for tests and the offline demo; `SupabaseStore` is the
 * production store. `createStoreFromEnv()` picks one at startup and says so.
 *
 * Every method is async and may throw `StoreUnavailableError`. The server maps
 * that to 503 `store_unavailable` and never falls back to memory once a real
 * store is configured: a nonce we failed to persist is a nonce we cannot honour.
 */

/** Where a sold reading came from. Mirrored in web/lib/relay.ts. */
export type SaleSource = 'badge' | 'simulator' | 'esp32c3';

export interface NonceEntry {
  expiresAt: number;
  used: boolean;
  payTo: string;
  amountMicroUsdc: string;
  /** Device the challenge was issued for. */
  deviceId: string;
  network: string;
}

export type ConsumeResult =
  | { ok: true; entry: NonceEntry }
  | { ok: false; reason: 'nonce_unknown' | 'nonce_replayed' | 'nonce_expired' };

export interface SaleRecord {
  /** Equals the nonce. */
  id: string;
  nonce: string;
  amountMicroUsdc: string;
  /** Unix seconds. */
  timestamp: number;
  txSignature: string;
  source: SaleSource;
  deviceId?: string;
  relayId: string;
  network: string;
  /** Buyer wallet from the parsed transaction; 'unverified' in trust mode. */
  payer?: string;
  agentId?: string | null;
  userId?: string | null;
  /** The signed receipt. A bearer token until redeemed: never listed publicly. */
  receipt?: string;
}

export type SettlementResult =
  | { ok: true }
  | { ok: false; reason: 'signature_reused' | 'nonce_already_settled'; priorNonce?: string; priorReceipt?: string };

export interface AgentRef {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface RelayRow {
  /** Facilitator Ed25519 public key, hex. Stable across restarts. */
  id: string;
  label: string;
  publicUrl: string;
  vendorWallet: string;
  network: string;
  settlement: 'verify' | 'trust';
  /** Same key, base64url — what receipts verify against. */
  facilitatorPubkey: string;
  version?: string;
  /** Unix seconds. */
  lastSeen: number;
}

export interface DeviceRow {
  relayId: string;
  id: string;
  source: SaleSource;
  label?: string;
  resource: string;
  priceMicroUsdc: string;
  payTo: string;
  network: string;
  chip?: string;
  url?: string;
  heartbeatSec?: number;
  /** Non-personal snapshot: freeHeap, largestBlock, badgeState, ageSeconds. */
  stats?: Record<string, unknown>;
  /** Unix seconds. */
  lastSeen: number;
}

export class StoreUnavailableError extends Error {
  constructor(
    public readonly op: string,
    public readonly cause: unknown,
  ) {
    super(`store unavailable during ${op}: ${describe(cause)}`);
    this.name = 'StoreUnavailableError';
  }
}

function describe(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    const c = cause as { code?: unknown; message?: unknown };
    if (typeof c.message === 'string') return c.code ? `${String(c.code)} ${c.message}` : c.message;
  }
  return String(cause);
}

export interface Store {
  readonly kind: 'memory' | 'supabase';

  // Nonces, scoped to this relay's identity.
  issueNonce(nonce: string, entry: NonceEntry): Promise<void>;
  peekNonce(nonce: string): Promise<NonceEntry | undefined>;
  /** Atomic single-use burn. */
  consumeNonce(nonce: string): Promise<ConsumeResult>;
  /** Delete nonces that expired more than `graceSec` ago. Returns how many. */
  sweepExpiredNonces(graceSec: number): Promise<number>;

  // Settlement: claiming the tx signature and recording the sale are one write.
  recordSettlement(sale: SaleRecord): Promise<SettlementResult>;
  /** This relay's sales, newest first, receipts stripped. */
  listSales(opts?: { limit?: number; source?: SaleSource; deviceId?: string }): Promise<SaleRecord[]>;
  /** One agent's purchases across every relay, newest first, receipts included. */
  listSalesForAgent(agentId: string, limit?: number): Promise<SaleRecord[]>;

  // Agents (API keys minted on the website).
  lookupAgentByKeyHash(keyHash: string): Promise<AgentRef | null>;

  // Directory.
  heartbeat(relay: RelayRow, devices: DeviceRow[]): Promise<void>;
  listDirectory(): Promise<{ relays: RelayRow[]; devices: DeviceRow[] }>;
}
