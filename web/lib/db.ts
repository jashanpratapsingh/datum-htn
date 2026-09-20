import 'server-only';
import { createSupabasePublic } from './supabase/public';
import { RELAYS, type RelayInfo } from './relays';
import type { LedgerEntry, SaleEntry } from './relay';

/**
 * History from Supabase: what the relays have written, readable with the
 * publishable key through RLS-public tables and views. Live device state and
 * the 402 handshake still go through the relay (lib/relay.ts); this is what
 * keeps /marketplace and /ledger complete when a relay is off.
 */

export type DbResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface DirectoryRelay extends RelayInfo {
  /** Facilitator pubkey hex, the row id. */
  id: string;
  vendorWallet: string;
  network: string;
  settlement: 'verify' | 'trust';
  lastSeen: number;
  state: 'live' | 'stale' | 'lost';
}

export interface DirectoryDevice {
  relayId: string;
  relay: RelayInfo;
  id: string;
  source: SaleEntry['source'];
  resource: string;
  priceMicroUsdc: string;
  payTo: string;
  network: string;
  chip?: string;
  stats?: Record<string, unknown>;
  lastSeen: number;
  state: 'live' | 'stale' | 'lost';
}

interface RelayRow {
  id: string;
  label: string;
  public_url: string;
  vendor_wallet: string;
  network: string;
  settlement: 'verify' | 'trust';
  last_seen: string;
}
interface DeviceRow {
  relay_id: string;
  id: string;
  source: SaleEntry['source'];
  resource: string;
  price_micro_usdc: number | string;
  pay_to: string;
  network: string;
  chip: string | null;
  stats: Record<string, unknown> | null;
  last_seen: string;
}
interface PublicSaleRow {
  id: string;
  nonce: string;
  relay_id: string;
  device_id: string | null;
  source: SaleEntry['source'];
  amount_micro_usdc: number | string;
  tx_signature: string;
  network: string;
  payer: string | null;
  attributed: boolean;
  via_account: boolean;
  settled_at: string;
}

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const stateOf = (lastSeen: number, now = Math.floor(Date.now() / 1000)): DirectoryRelay['state'] => {
  const age = now - lastSeen;
  return age <= 90 ? 'live' : age <= 600 ? 'stale' : 'lost';
};
const normUrl = (u: string) => u.replace(/\/+$/, '');

/**
 * A DB relay reuses the env-configured key when its public URL matches one of
 * RELAYS (so composite device ids and ?relay= keep working); otherwise the
 * first 12 hex of its id is the key.
 */
function relayInfoOf(row: RelayRow): RelayInfo {
  const env = RELAYS.find((r) => normUrl(r.url) === normUrl(row.public_url));
  if (env) return env;
  return { key: row.id.slice(0, 12), label: row.label, url: normUrl(row.public_url) };
}

async function fetchDirectoryRows(): Promise<DbResult<{ relays: RelayRow[]; devices: DeviceRow[] }>> {
  const sb = createSupabasePublic();
  if (!sb) return { ok: false, message: 'supabase not configured' };
  const [r, d] = await Promise.all([
    sb.from('vendx_relays').select('id, label, public_url, vendor_wallet, network, settlement, last_seen').order('last_seen', { ascending: false }).limit(200),
    sb.from('vendx_devices').select('relay_id, id, source, resource, price_micro_usdc, pay_to, network, chip, stats, last_seen').order('last_seen', { ascending: false }).limit(1000),
  ]);
  if (r.error) return { ok: false, message: r.error.message };
  if (d.error) return { ok: false, message: d.error.message };
  return { ok: true, data: { relays: (r.data ?? []) as RelayRow[], devices: (d.data ?? []) as DeviceRow[] } };
}

export async function dbDirectory(): Promise<DbResult<{ relays: DirectoryRelay[]; devices: DirectoryDevice[] }>> {
  const rows = await fetchDirectoryRows();
  if (!rows.ok) return rows;
  const byId = new Map<string, RelayInfo>();
  const relays: DirectoryRelay[] = rows.data.relays.map((row) => {
    const info = relayInfoOf(row);
    byId.set(row.id, info);
    const lastSeen = unix(row.last_seen);
    return { ...info, id: row.id, vendorWallet: row.vendor_wallet, network: row.network, settlement: row.settlement, lastSeen, state: stateOf(lastSeen) };
  });
  const devices: DirectoryDevice[] = rows.data.devices
    .filter((d) => byId.has(d.relay_id))
    .map((d) => {
      const lastSeen = unix(d.last_seen);
      return {
        relayId: d.relay_id,
        relay: byId.get(d.relay_id)!,
        id: d.id,
        source: d.source,
        resource: d.resource,
        priceMicroUsdc: String(d.price_micro_usdc),
        payTo: d.pay_to,
        network: d.network,
        chip: d.chip ?? undefined,
        stats: d.stats ?? undefined,
        lastSeen,
        state: stateOf(lastSeen),
      };
    });
  return { ok: true, data: { relays, devices } };
}

/** Every relay the site knows: env-configured first, then directory-only ones. */
export async function dbRelays(): Promise<RelayInfo[]> {
  const dir = await dbDirectory();
  const out: RelayInfo[] = [...RELAYS];
  if (dir.ok) for (const r of dir.data.relays) if (!out.some((x) => x.key === r.key)) out.push({ key: r.key, label: r.label, url: r.url });
  return out;
}

async function fetchPublicSales(limit: number): Promise<DbResult<{ sales: PublicSaleRow[]; relays: Map<string, RelayInfo>; devices: DeviceRow[] }>> {
  const sb = createSupabasePublic();
  if (!sb) return { ok: false, message: 'supabase not configured' };
  const [s, dir] = await Promise.all([
    sb.from('vendx_sales_public').select('*').order('settled_at', { ascending: false }).limit(limit),
    fetchDirectoryRows(),
  ]);
  if (s.error) return { ok: false, message: s.error.message };
  const relays = new Map<string, RelayInfo>();
  if (dir.ok) for (const r of dir.data.relays) relays.set(r.id, relayInfoOf(r));
  return { ok: true, data: { sales: (s.data ?? []) as PublicSaleRow[], relays, devices: dir.ok ? dir.data.devices : [] } };
}

/** A relay that has sold but never heartbeated: label it by its id prefix rather than dropping the sale. */
const unknownRelay = (id: string): RelayInfo => ({ key: id.slice(0, 12), label: `relay ${id.slice(0, 8)}`, url: '' });

export async function dbSales(limit = 500): Promise<DbResult<SaleEntry[]>> {
  const r = await fetchPublicSales(limit);
  if (!r.ok) return r;
  return {
    ok: true,
    data: r.data.sales.map<SaleEntry>((s) => ({
      id: s.id,
      relay: r.data.relays.get(s.relay_id) ?? unknownRelay(s.relay_id),
      deviceId: s.device_id ?? 'device',
      timestamp: unix(s.settled_at),
      amount: String(s.amount_micro_usdc),
      signature: s.tx_signature,
      resource: '/api/telemetry',
      description: 'telemetry read',
      source: s.source,
      payer: s.payer ?? undefined,
      attributed: s.attributed || s.via_account,
    })),
  };
}

export async function dbLedger(limit = 500): Promise<DbResult<LedgerEntry[]>> {
  const r = await fetchPublicSales(limit);
  if (!r.ok) return r;
  const payToOf = (relayId: string, deviceId: string | null) =>
    r.data.devices.find((d) => d.relay_id === relayId && d.id === deviceId)?.pay_to ??
    r.data.devices.find((d) => d.relay_id === relayId)?.pay_to ??
    '';
  return {
    ok: true,
    data: r.data.sales.map<LedgerEntry>((s) => ({
      relay: r.data.relays.get(s.relay_id) ?? unknownRelay(s.relay_id),
      nonce: s.nonce,
      signature: s.tx_signature,
      payTo: payToOf(s.relay_id, s.device_id),
      amount: String(s.amount_micro_usdc),
      network: s.network,
      issuedAt: unix(s.settled_at),
      expiresAt: unix(s.settled_at) + 300,
    })),
  };
}
