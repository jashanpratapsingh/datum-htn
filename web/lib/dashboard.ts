import 'server-only';
import { PublicKey } from '@solana/web3.js';
import { createSupabaseServer } from '@/lib/supabase/server';
import { walletBalances } from '@/lib/solana/serverBuyer';

/**
 * Everything the account dashboard shows, read AS THE USER through RLS
 * (agents, tokens, readings, sales), plus live wallet balances from devnet.
 */

export interface AgentView {
  id: string;
  name: string;
  keyPrefix: string;
  createdVia: 'key' | 'oauth';
  clientName: string | null;
  walletPubkey: string | null;
  dailyCapMicro: number | null;
  perRequestCapMicro: number;
  spentMicro: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  connections: Array<{ clientId: string; lastUsedAt: string | null; createdAt: string; expiresAt: string }>;
  balance: { lamports: number; usdcMicro: number | null } | null;
}

export interface ReadingPoint {
  at: number;
  device: string;
  relayId: string;
  source: string;
  value: number;
  metric: string;
  agentId: string | null;
}

export interface SaleView {
  id: string;
  nonce: string;
  relayId: string;
  deviceId: string | null;
  source: 'badge' | 'simulator' | 'esp32c3';
  amountMicro: number;
  txSignature: string;
  network: string;
  agentId: string | null;
  settledAt: string;
}

export interface Dashboard {
  agents: AgentView[];
  readings: ReadingPoint[];
  sales: SaleView[];
  unchartedReadings: number;
}

/** What a viewer with no Supabase session sees: nothing to read, honestly. */
export function emptyDashboard(): Dashboard {
  return { agents: [], readings: [], sales: [], unchartedReadings: 0 };
}

export async function loadDashboard(): Promise<Dashboard> {
  const supabase = await createSupabaseServer();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [agentsRes, tokensRes, readingsRes, salesRes] = await Promise.all([
    supabase
      .from('vendx_agents')
      .select('id, name, key_prefix, created_via, client_name, wallet_pubkey, daily_cap_micro_usdc, per_request_cap_micro_usdc, spent_micro_usdc, created_at, last_used_at, revoked_at')
      .order('created_at', { ascending: false }),
    supabase.from('vendx_oauth_tokens').select('agent_id, client_id, kind, created_at, last_used_at, expires_at, revoked_at').eq('kind', 'refresh').is('revoked_at', null),
    supabase.from('vendx_readings').select('agent_id, device_id, relay_id, source, metric, value, fetched_at').gte('fetched_at', since).order('fetched_at', { ascending: true }).limit(2000),
    supabase
      .from('vendx_sales')
      .select('id, nonce, relay_id, device_id, source, amount_micro_usdc, tx_signature, network, agent_id, settled_at')
      .order('settled_at', { ascending: false })
      .limit(200),
  ]);

  type AgentRow = { id: string; name: string; key_prefix: string; created_via: 'key' | 'oauth'; client_name: string | null; wallet_pubkey: string | null; daily_cap_micro_usdc: number | string | null; per_request_cap_micro_usdc: number | string; spent_micro_usdc: number | string; created_at: string; last_used_at: string | null; revoked_at: string | null };
  type TokenRow = { agent_id: string; client_id: string; created_at: string; last_used_at: string | null; expires_at: string };
  type ReadingRow = { agent_id: string | null; device_id: string; relay_id: string; source: string; metric: string | null; value: number | string | null; fetched_at: string };
  type SaleRow = { id: string; nonce: string; relay_id: string; device_id: string | null; source: SaleView['source']; amount_micro_usdc: number | string; tx_signature: string; network: string; agent_id: string | null; settled_at: string };

  const tokens = (tokensRes.data ?? []) as TokenRow[];
  const agentRows = (agentsRes.data ?? []) as AgentRow[];

  const balances = await Promise.all(
    agentRows.map(async (a) => {
      if (!a.wallet_pubkey || a.revoked_at) return null;
      try {
        const b = await Promise.race([walletBalances(new PublicKey(a.wallet_pubkey)), new Promise<null>((r) => setTimeout(() => r(null), 6_000))]);
        return b ? { lamports: Number(b.lamports), usdcMicro: b.usdcMicro === null ? null : Number(b.usdcMicro) } : null;
      } catch {
        return null;
      }
    }),
  );

  const agents: AgentView[] = agentRows.map((a, i) => ({
    id: a.id,
    name: a.name,
    keyPrefix: a.key_prefix,
    createdVia: a.created_via,
    clientName: a.client_name,
    walletPubkey: a.wallet_pubkey,
    dailyCapMicro: a.daily_cap_micro_usdc === null ? null : Number(a.daily_cap_micro_usdc),
    perRequestCapMicro: Number(a.per_request_cap_micro_usdc),
    spentMicro: Number(a.spent_micro_usdc),
    createdAt: a.created_at,
    lastUsedAt: a.last_used_at,
    revokedAt: a.revoked_at,
    connections: tokens.filter((t) => t.agent_id === a.id).map((t) => ({ clientId: t.client_id, lastUsedAt: t.last_used_at, createdAt: t.created_at, expiresAt: t.expires_at })),
    balance: balances[i],
  }));

  const readingRows = (readingsRes.data ?? []) as ReadingRow[];
  const readings: ReadingPoint[] = readingRows
    .filter((r) => r.value !== null && r.metric)
    .map((r) => ({ at: Date.parse(r.fetched_at), device: r.device_id, relayId: r.relay_id, source: r.source, value: Number(r.value), metric: r.metric as string, agentId: r.agent_id }));

  const sales: SaleView[] = ((salesRes.data ?? []) as SaleRow[]).map((s) => ({
    id: s.id,
    nonce: s.nonce,
    relayId: s.relay_id,
    deviceId: s.device_id,
    source: s.source,
    amountMicro: Number(s.amount_micro_usdc),
    txSignature: s.tx_signature,
    network: s.network,
    agentId: s.agent_id,
    settledAt: s.settled_at,
  }));

  return { agents, readings, sales, unchartedReadings: readingRows.length - readings.length };
}
