/**
 * In-process store. Exactly the pre-Supabase behaviour: a nonce Map with a
 * 60 s prune loop, a Set of used transaction signatures, a newest-first sales
 * array capped at 1000. Nothing survives a restart, and the server says so at
 * startup and in /health. Used by the tests and scripts/demo.mjs.
 */

import type {
  AgentRef,
  ConsumeResult,
  DeviceRow,
  NonceEntry,
  RelayRow,
  SaleRecord,
  SaleSource,
  SettlementResult,
  Store,
} from './types.js';

const now = () => Math.floor(Date.now() / 1000);

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;

  private readonly nonces = new Map<string, NonceEntry>();
  private readonly sales: SaleRecord[] = [];
  private readonly usedSignatures = new Map<string, { nonce: string; receipt?: string }>();
  private readonly agents = new Map<string, AgentRef>(); // key: sha256 hex of the API key
  private readonly relays = new Map<string, RelayRow>();
  private readonly devices = new Map<string, DeviceRow>(); // key: `${relayId}/${id}`

  constructor() {
    // Prune expired entries every 60 s so the map doesn't grow unbounded.
    setInterval(() => {
      void this.sweepExpiredNonces(0);
    }, 60_000).unref();
  }

  async issueNonce(nonce: string, entry: NonceEntry): Promise<void> {
    this.nonces.set(nonce, { ...entry });
  }

  async peekNonce(nonce: string): Promise<NonceEntry | undefined> {
    const e = this.nonces.get(nonce);
    return e ? { ...e } : undefined;
  }

  async consumeNonce(nonce: string): Promise<ConsumeResult> {
    const entry = this.nonces.get(nonce);
    if (!entry) return { ok: false, reason: 'nonce_unknown' };
    if (entry.used) return { ok: false, reason: 'nonce_replayed' };
    if (entry.expiresAt < now()) return { ok: false, reason: 'nonce_expired' };
    entry.used = true;
    return { ok: true, entry: { ...entry } };
  }

  async sweepExpiredNonces(graceSec: number): Promise<number> {
    const cutoff = now() - graceSec;
    let n = 0;
    for (const [k, v] of this.nonces) {
      if (v.expiresAt < cutoff) {
        this.nonces.delete(k);
        n++;
      }
    }
    return n;
  }

  async recordSettlement(sale: SaleRecord): Promise<SettlementResult> {
    const prior = this.usedSignatures.get(sale.txSignature);
    if (prior) return { ok: false, reason: 'signature_reused', priorNonce: prior.nonce, priorReceipt: prior.receipt };
    const dup = this.sales.find((s) => s.id === sale.id);
    if (dup) return { ok: false, reason: 'nonce_already_settled', priorNonce: dup.nonce, priorReceipt: dup.receipt };
    this.usedSignatures.set(sale.txSignature, { nonce: sale.nonce, receipt: sale.receipt });
    this.sales.unshift({ ...sale });
    if (this.sales.length > 1000) this.sales.length = 1000;
    if (sale.agentId) {
      for (const a of this.agents.values()) {
        if (a.id === sale.agentId) a.lastUsedAt = new Date().toISOString();
      }
    }
    return { ok: true };
  }

  async listSales(opts: { limit?: number; source?: SaleSource; deviceId?: string } = {}): Promise<SaleRecord[]> {
    let rows = this.sales;
    if (opts.source) rows = rows.filter((s) => s.source === opts.source);
    if (opts.deviceId) rows = rows.filter((s) => s.deviceId === opts.deviceId);
    return rows.slice(0, opts.limit ?? 200).map(({ receipt: _r, ...s }) => ({ ...s }));
  }

  async listSalesForAgent(agentId: string, limit = 50): Promise<SaleRecord[]> {
    return this.sales.filter((s) => s.agentId === agentId).slice(0, limit).map((s) => ({ ...s }));
  }

  async lookupAgentByKeyHash(keyHash: string): Promise<AgentRef | null> {
    const a = this.agents.get(keyHash);
    return a ? { ...a } : null;
  }

  async heartbeat(relay: RelayRow, devices: DeviceRow[]): Promise<void> {
    this.relays.set(relay.id, { ...relay });
    for (const d of devices) this.devices.set(`${d.relayId}/${d.id}`, { ...d });
  }

  async listDirectory(): Promise<{ relays: RelayRow[]; devices: DeviceRow[] }> {
    const byNewest = <T extends { lastSeen: number }>(a: T, b: T) => b.lastSeen - a.lastSeen;
    return {
      relays: [...this.relays.values()].map((r) => ({ ...r })).sort(byNewest),
      devices: [...this.devices.values()].map((d) => ({ ...d })).sort(byNewest),
    };
  }

  /** Test hook: register an agent so an API key resolves without Supabase. */
  seedAgent(agent: AgentRef & { keyHash: string }): void {
    const { keyHash, ...ref } = agent;
    this.agents.set(keyHash, ref);
  }
}
