/**
 * Supabase-backed store. The relay is the only writer (service-role key); the
 * website reads public views. Schema: supabase/migrations/0003_persistence.sql.
 *
 * Fail closed: every PostgREST error becomes a StoreUnavailableError. There is
 * no memory fallback once this store is selected — the server answers 503 and
 * /health degrades instead of issuing nonces it cannot remember.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  StoreUnavailableError,
  type AgentRef,
  type ConsumeResult,
  type DeviceRow,
  type NonceEntry,
  type RelayRow,
  type SaleRecord,
  type SaleSource,
  type SettlementResult,
  type Store,
} from './types.js';

const QUERY_TIMEOUT_MS = 8_000;

interface NonceRowDb {
  nonce: string;
  expires_at: number;
  used_at: number | null;
  device_id: string;
  network: string;
  pay_to: string;
  amount: string;
}

interface SaleRowDb {
  id: string;
  nonce: string;
  relay_id: string;
  device_id: string | null;
  source: SaleSource;
  amount_micro_usdc: number | string;
  tx_signature: string;
  network: string;
  payer: string | null;
  agent_id: string | null;
  user_id: string | null;
  receipt?: string | null;
  settled_at: string;
}

interface AgentRowDb {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface RelayRowDb {
  id: string;
  label: string;
  public_url: string;
  vendor_wallet: string;
  network: string;
  settlement: 'verify' | 'trust';
  facilitator_pubkey: string;
  version: string | null;
  last_seen: string;
}

interface DeviceRowDb {
  relay_id: string;
  id: string;
  source: SaleSource;
  label: string | null;
  resource: string;
  price_micro_usdc: number | string;
  pay_to: string;
  network: string;
  chip: string | null;
  url: string | null;
  heartbeat_sec: number | null;
  stats: Record<string, unknown> | null;
  last_seen: string;
}

const SALE_COLS_PUBLIC =
  'id, nonce, relay_id, device_id, source, amount_micro_usdc, tx_signature, network, payer, agent_id, user_id, settled_at';
const SALE_COLS_FULL = `${SALE_COLS_PUBLIC}, receipt`;

const unixSec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const isoNow = () => new Date().toISOString();

function saleFromDb(r: SaleRowDb): SaleRecord {
  const out: SaleRecord = {
    id: r.id,
    nonce: r.nonce,
    amountMicroUsdc: String(r.amount_micro_usdc),
    timestamp: unixSec(r.settled_at),
    txSignature: r.tx_signature,
    source: r.source,
    deviceId: r.device_id ?? undefined,
    relayId: r.relay_id,
    network: r.network,
    payer: r.payer ?? undefined,
    agentId: r.agent_id,
    userId: r.user_id,
  };
  if (typeof r.receipt === 'string') out.receipt = r.receipt;
  return out;
}

export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private readonly sb: SupabaseClient;

  constructor(
    url: string,
    secretKey: string,
    private readonly relayId: string,
  ) {
    this.sb = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) }),
      },
    });
  }

  private fail(op: string, cause: unknown): never {
    throw new StoreUnavailableError(op, cause);
  }

  async issueNonce(nonce: string, entry: NonceEntry): Promise<void> {
    const { error } = await this.sb.from('vendx_nonces').insert({
      nonce,
      expires_at: entry.expiresAt,
      used_at: null,
      device_id: entry.deviceId,
      network: entry.network,
      pay_to: entry.payTo,
      amount: entry.amountMicroUsdc,
      relay_id: this.relayId,
    });
    if (error) this.fail('issueNonce', error);
  }

  async peekNonce(nonce: string): Promise<NonceEntry | undefined> {
    const { data, error } = await this.sb
      .from('vendx_nonces')
      .select('nonce, expires_at, used_at, device_id, network, pay_to, amount')
      .eq('nonce', nonce)
      .eq('relay_id', this.relayId)
      .maybeSingle<NonceRowDb>();
    if (error) this.fail('peekNonce', error);
    if (!data) return undefined;
    return {
      expiresAt: Number(data.expires_at),
      used: data.used_at !== null,
      payTo: data.pay_to,
      amountMicroUsdc: data.amount,
      deviceId: data.device_id,
      network: data.network,
    };
  }

  async consumeNonce(nonce: string): Promise<ConsumeResult> {
    const { data, error } = await this.sb.rpc('vendx_consume_nonce', {
      p_nonce: nonce,
      p_relay_id: this.relayId,
      p_now: Math.floor(Date.now() / 1000),
    });
    if (error) this.fail('consumeNonce', error);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { status: string; expires_at: number | null; pay_to: string | null; amount: string | null; device_id: string | null; network: string | null }
      | undefined;
    if (!row) this.fail('consumeNonce', 'empty rpc result');
    if (row.status !== 'ok') {
      const reason = row.status as 'nonce_unknown' | 'nonce_replayed' | 'nonce_expired';
      return { ok: false, reason };
    }
    return {
      ok: true,
      entry: {
        expiresAt: Number(row.expires_at),
        used: true,
        payTo: row.pay_to ?? '',
        amountMicroUsdc: row.amount ?? '0',
        deviceId: row.device_id ?? '',
        network: row.network ?? 'solana-devnet',
      },
    };
  }

  async sweepExpiredNonces(graceSec: number): Promise<number> {
    const cutoff = Math.floor(Date.now() / 1000) - graceSec;
    const { count, error } = await this.sb
      .from('vendx_nonces')
      .delete({ count: 'exact' })
      .eq('relay_id', this.relayId)
      .lt('expires_at', cutoff);
    if (error) this.fail('sweepExpiredNonces', error);
    return count ?? 0;
  }

  async recordSettlement(sale: SaleRecord): Promise<SettlementResult> {
    const { data, error } = await this.sb.rpc('vendx_record_settlement', {
      p_tx_signature: sale.txSignature,
      p_nonce: sale.nonce,
      p_relay_id: sale.relayId,
      p_device_id: sale.deviceId ?? null,
      p_source: sale.source,
      p_amount_micro_usdc: Number(sale.amountMicroUsdc),
      p_network: sale.network,
      p_payer: sale.payer ?? null,
      p_agent_id: sale.agentId ?? null,
      p_user_id: sale.userId ?? null,
      p_receipt: sale.receipt ?? null,
    });
    if (error) this.fail('recordSettlement', error);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { status: string; prior_nonce: string | null; prior_receipt: string | null }
      | undefined;
    if (!row) this.fail('recordSettlement', 'empty rpc result');
    if (row.status === 'ok') return { ok: true };
    return {
      ok: false,
      reason: row.status === 'signature_reused' ? 'signature_reused' : 'nonce_already_settled',
      priorNonce: row.prior_nonce ?? undefined,
      priorReceipt: row.prior_receipt ?? undefined,
    };
  }

  async listSales(opts: { limit?: number; source?: SaleSource; deviceId?: string } = {}): Promise<SaleRecord[]> {
    let q = this.sb
      .from('vendx_sales')
      .select(SALE_COLS_PUBLIC)
      .eq('relay_id', this.relayId)
      .order('settled_at', { ascending: false })
      .limit(Math.min(opts.limit ?? 200, 1000));
    if (opts.source) q = q.eq('source', opts.source);
    if (opts.deviceId) q = q.eq('device_id', opts.deviceId);
    const { data, error } = await q;
    if (error) this.fail('listSales', error);
    return ((data ?? []) as unknown as SaleRowDb[]).map(saleFromDb);
  }

  async listSalesForAgent(agentId: string, limit = 50): Promise<SaleRecord[]> {
    const { data, error } = await this.sb
      .from('vendx_sales')
      .select(SALE_COLS_FULL)
      .eq('agent_id', agentId)
      .order('settled_at', { ascending: false })
      .limit(Math.min(limit, 200));
    if (error) this.fail('listSalesForAgent', error);
    return ((data ?? []) as unknown as SaleRowDb[]).map(saleFromDb);
  }

  async lookupAgentByKeyHash(keyHash: string): Promise<AgentRef | null> {
    const { data, error } = await this.sb
      .from('vendx_agents')
      .select('id, user_id, name, key_prefix, created_at, last_used_at, revoked_at')
      .eq('key_hash', keyHash)
      .maybeSingle<AgentRowDb>();
    if (error) this.fail('lookupAgentByKeyHash', error);
    if (!data) return null;
    return {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      keyPrefix: data.key_prefix,
      createdAt: data.created_at,
      lastUsedAt: data.last_used_at,
      revokedAt: data.revoked_at,
    };
  }

  async heartbeat(relay: RelayRow, devices: DeviceRow[]): Promise<void> {
    const ts = isoNow();
    const { error: e1 } = await this.sb.from('vendx_relays').upsert(
      {
        id: relay.id,
        label: relay.label,
        public_url: relay.publicUrl,
        vendor_wallet: relay.vendorWallet,
        network: relay.network,
        settlement: relay.settlement,
        facilitator_pubkey: relay.facilitatorPubkey,
        version: relay.version ?? null,
        last_seen: ts,
      },
      { onConflict: 'id' },
    );
    if (e1) this.fail('heartbeat.relay', e1);
    if (devices.length === 0) return;
    const { error: e2 } = await this.sb.from('vendx_devices').upsert(
      devices.map((d) => ({
        relay_id: d.relayId,
        id: d.id,
        source: d.source,
        label: d.label ?? null,
        resource: d.resource,
        price_micro_usdc: Number(d.priceMicroUsdc),
        pay_to: d.payTo,
        network: d.network,
        chip: d.chip ?? null,
        url: d.url ?? null,
        heartbeat_sec: d.heartbeatSec ?? null,
        stats: d.stats ?? null,
        last_seen: ts,
      })),
      { onConflict: 'relay_id,id' },
    );
    if (e2) this.fail('heartbeat.devices', e2);
  }

  async listDirectory(): Promise<{ relays: RelayRow[]; devices: DeviceRow[] }> {
    const [r, d] = await Promise.all([
      this.sb.from('vendx_relays').select('*').order('last_seen', { ascending: false }).limit(200),
      this.sb.from('vendx_devices').select('*').order('last_seen', { ascending: false }).limit(1000),
    ]);
    if (r.error) this.fail('listDirectory.relays', r.error);
    if (d.error) this.fail('listDirectory.devices', d.error);
    return {
      relays: ((r.data ?? []) as RelayRowDb[]).map((x) => ({
        id: x.id,
        label: x.label,
        publicUrl: x.public_url,
        vendorWallet: x.vendor_wallet,
        network: x.network,
        settlement: x.settlement,
        facilitatorPubkey: x.facilitator_pubkey,
        version: x.version ?? undefined,
        lastSeen: unixSec(x.last_seen),
      })),
      devices: ((d.data ?? []) as DeviceRowDb[]).map((x) => ({
        relayId: x.relay_id,
        id: x.id,
        source: x.source,
        label: x.label ?? undefined,
        resource: x.resource,
        priceMicroUsdc: String(x.price_micro_usdc),
        payTo: x.pay_to,
        network: x.network,
        chip: x.chip ?? undefined,
        url: x.url ?? undefined,
        heartbeatSec: x.heartbeat_sec ?? undefined,
        stats: x.stats ?? undefined,
        lastSeen: unixSec(x.last_seen),
      })),
    };
  }
}
