import type { PaymentRequiredBody } from '@vendx/protocol';
import { RELAYS, compositeId, splitCompositeId, type RelayInfo } from './relays';

export type { RelayInfo } from './relays';
export { RELAYS, MULTI_RELAY, PRIMARY_RELAY } from './relays';

/** Kept for callers that still want "the" relay; it is the primary one. */
export const RELAY_URL = RELAYS[0].url;

export type FailReason = 'offline' | 'not_found' | 'unimplemented' | 'error';

export interface RelayFailure {
  relay: RelayInfo;
  reason: FailReason;
  message?: string;
}

/**
 * `ok` means at least one relay answered. `failed` lists the relays that did
 * not, so a page can render what it has and say which vendor is dark instead
 * of hiding everything behind one offline state.
 */
export type RelayResult<T> =
  | { ok: true; data: T; failed: RelayFailure[] }
  | { ok: false; reason: FailReason; message?: string; failed: RelayFailure[] };

type One<T> = { ok: true; data: T } | { ok: false; reason: FailReason; message?: string };

async function _fetch<T>(relay: RelayInfo, path: string, init?: RequestInit): Promise<One<T>> {
  try {
    const res = await fetch(`${relay.url}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      ...init,
    });
    if (res.status === 404) return { ok: false, reason: 'unimplemented' };
    if (!res.ok) return { ok: false, reason: 'error', message: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'offline', message: msg };
  }
}

/** Ask every relay the same question; keep the answers and the failures apart. */
async function fanout<T>(
  f: (relay: RelayInfo) => Promise<One<T>>,
): Promise<{ oks: Array<{ relay: RelayInfo; data: T }>; failed: RelayFailure[] }> {
  const results = await Promise.all(RELAYS.map(async (relay) => ({ relay, r: await f(relay) })));
  const oks: Array<{ relay: RelayInfo; data: T }> = [];
  const failed: RelayFailure[] = [];
  for (const { relay, r } of results) {
    if (r.ok) oks.push({ relay, data: r.data });
    else failed.push({ relay, reason: r.reason, message: r.message });
  }
  return { oks, failed };
}

function combine<A, B>(
  oks: Array<{ relay: RelayInfo; data: A }>,
  failed: RelayFailure[],
  merge: (oks: Array<{ relay: RelayInfo; data: A }>) => B,
): RelayResult<B> {
  if (oks.length === 0) {
    return { ok: false, reason: failed[0]?.reason ?? 'offline', message: failed[0]?.message, failed };
  }
  return { ok: true, data: merge(oks), failed };
}

/* ------------------------------------------------------------------ *
   Page-facing types. These are what components consume.
 * ------------------------------------------------------------------ */

export interface MotionReading {
  state: string;
  score: number;
  at: number;
}

/**
 * Provenance of a device or a sale. `badge`: read off the conference badge's
 * serial console by the relay. `esp32c3`: a VENDX node running
 * firmware-vendor, serving x402 itself and registered with the relay.
 * `simulator`: software. Mirrors SaleSource in relay-proxy/src/store/types.ts.
 */
export type Source = 'badge' | 'simulator' | 'esp32c3';

export interface DeviceEntry {
  kind: 'vendor';
  id: string;
  /** The relay (vendor) this device is sold through. */
  relay: RelayInfo;
  source: Source;
  /** Registered nodes only: where an agent reaches the node directly. */
  url?: string;
  /** Registered nodes only: live / stale / lost by heartbeat age. */
  nodeState?: 'live' | 'stale' | 'lost';
  /** Registered nodes only: the relay confirmed the URL answers as this device. */
  reachable?: boolean;
  chip?: string;
  /** Presence-node (WiFi ESP32-C3) fields. Absent on the console badge and the simulator. */
  motion?: MotionReading;
  location?: string;
  firmware?: string;
  transport?: string;
  rssiDbm?: number;
  uptimeSeconds?: number;
  sensing?: { enabled: boolean; ready: boolean; calibrating: boolean; threshold: number };
  deviceHash?: string;
  freeHeap?: number;
  largestBlock?: number;
  lvglUsedPct?: number;
  bleState?: number;
  bootCount?: number;
  resetReasons?: Record<string, number>;
  taskCount?: number;
  lastSeen?: number;
  fsBytes?: number;
  earningsMicroUsdc?: string;
  totalSales?: number;
  priceUsd?: number;
}

/**
 * A WiFi-CSI motion sensor discovered on the LAN via mDNS (see
 * relay-proxy/src/espectre-discovery.ts). It isn't an x402 vendor — no
 * wallet, no price, nothing sold — so it carries none of DeviceEntry's
 * earnings/sales fields rather than fake them.
 */
export interface SensorEntry {
  kind: 'sensor';
  id: string;
  relay: RelayInfo;
  source: 'espectre';
  name?: string;
  chip?: string;
  firmware?: string;
  motionState?: 'idle' | 'motion';
  threshold?: number;
  ready?: boolean;
  online: boolean;
  lastSeen: number;
}

export type FleetEntry = DeviceEntry | SensorEntry;

/** Link to a device page; the relay key rides along so the id is unambiguous. */
export const deviceHref = (d: Pick<FleetEntry, 'id' | 'relay'>) =>
  `/devices/${encodeURIComponent(compositeId(d.relay, d.id))}`;

export interface SaleEntry {
  id: string;
  relay: RelayInfo;
  deviceId: string;
  timestamp: number;
  /** micro-USDC, decimal string */
  amount: string;
  signature: string;
  resource: string;
  description: string;
  source: Source;
  /** Buyer wallet, when the relay verified the transfer on-chain. */
  payer?: string;
  /** True when the sale was tied to an account (agent key or web purchase). */
  attributed?: boolean;
}

export interface WalletSpend {
  wallet: string;
  spentMicroUsdc: string;
  remainingMicroUsdc: string;
  sales: number;
  lastSaleAt: number | null;
}

export interface PolicyStatus {
  relay: RelayInfo;
  /** The buyer agent's budget (agent-buyer's data/spend-ledger.json on that relay's machine). */
  dailyCapMicroUsdc: string;
  spentMicroUsdc: string;
  remainingMicroUsdc: string;
  date: string;
  /** Whether this relay learns the payer from the chain (verify mode). Undefined on older relays. */
  payersVerified?: boolean;
  /** The asked-for wallet's spend today on this relay; undefined when not asked or when the relay predates it. */
  wallet?: WalletSpend;
  /** Not served by the relay yet. Absent, not empty — the page must say so. */
  denials?: Array<{ timestamp: number; reason: string; amount: string; deviceId?: string }>;
}

export interface LedgerEntry {
  relay: RelayInfo;
  nonce: string;
  signature: string;
  payTo: string;
  amount: string;
  network: string;
  issuedAt: number;
  expiresAt: number;
}

/* ------------------------------------------------------------------ *
   Wire shapes — what relay-proxy/src/server.ts actually returns.

   These are deliberately separate from the page-facing types above. The
   round-two fleet shipped a frontend typed against bare arrays and a backend
   returning wrapped objects with different field names, and every route test
   ran with the relay down, so nothing ever exercised the join. This file is
   now the one place the two are reconciled.
 * ------------------------------------------------------------------ */

interface WireDeviceSummary {
  id: string;
  source: Source;
  priceUsd: number;
  freeHeap: number | null;
  largestBlock: number | null;
  chip: string | null;
  lastSeen: number;
  totalSales: number;
  totalEarnedMicroUsdc: string;
  motion?: MotionReading;
  location?: string;
  firmware?: string;
  transport?: string;
  /** Registered nodes only. */
  url?: string;
  nodeState?: 'live' | 'stale' | 'lost';
  reachable?: boolean;
}

/** Mirrors EspectreSensorSnapshot in relay-proxy/src/espectre-discovery.ts. */
interface WireSensorSnapshot {
  kind: 'sensor';
  id: string;
  source: 'espectre';
  name?: string;
  chip?: string;
  firmware?: string;
  url: string;
  motionState?: 'idle' | 'motion';
  threshold?: number;
  ready?: boolean;
  online: boolean;
  lastSeen: number;
}

interface WireTelemetry {
  deviceId: string;
  timestamp: number;
  source: Source;
  url?: string;
  nodeState?: 'live' | 'stale' | 'lost';
  reachable?: boolean;
  chip?: string;
  motion?: MotionReading;
  location?: string;
  firmware?: string;
  transport?: string;
  rssiDbm?: number;
  uptimeSeconds?: number;
  sensing?: { enabled: boolean; ready: boolean; calibrating: boolean; threshold: number };
  deviceHash?: string;
  freeHeap?: number;
  largestBlock?: number;
  lvglUsedPct?: number;
  bleState?: number;
  bootCount?: number;
  resetReasons?: Record<string, number>;
  taskCount?: number;
  fsBytes?: number;
}

interface WireSale {
  id: string;
  nonce: string;
  amountMicroUsdc: string;
  timestamp: number;
  txSignature: string;
  source: Source;
  payer?: string;
  agentId?: string | null;
  userId?: string | null;
}

interface WirePolicy {
  capMicroUsdc: string;
  spentMicroUsdc: string;
  remainingMicroUsdc: string;
  date: string;
  /** Present on relays that know who paid (settlement verified on-chain). */
  payersVerified?: boolean;
  /** Only when asked with ?payer=; only on relays that serve it. */
  payer?: {
    wallet: string;
    spentMicroUsdc: string;
    remainingMicroUsdc: string;
    sales: number;
    lastSaleAt: number | null;
    date: string;
  };
}

interface WireLedger {
  programId: string;
  network: string;
  deployed: boolean;
  totalBuckets: number;
  totalSettledMicroUsdc: string;
}

/** Every sale is a telemetry read; the relay serves exactly one resource. */
const SALE_RESOURCE = '/api/telemetry';
const SALE_DESCRIPTION = 'telemetry read';

const byNewest = <T extends { timestamp: number }>(a: T, b: T) => b.timestamp - a.timestamp;

/* ------------------------------------------------------------------ *
   Accessors — each fans out across RELAYS and tags rows with their relay.
 * ------------------------------------------------------------------ */

function summaryToEntry(relay: RelayInfo, d: WireDeviceSummary): DeviceEntry {
  return {
    kind: 'vendor',
    id: d.id,
    relay,
    source: d.source,
    url: d.url,
    nodeState: d.nodeState,
    reachable: d.reachable,
    chip: d.chip ?? undefined,
    freeHeap: d.freeHeap ?? undefined,
    largestBlock: d.largestBlock ?? undefined,
    lastSeen: d.lastSeen,
    earningsMicroUsdc: d.totalEarnedMicroUsdc,
    totalSales: d.totalSales,
    priceUsd: d.priceUsd,
    motion: d.motion,
    location: d.location,
    firmware: d.firmware,
    transport: d.transport,
  };
}

function sensorToEntry(relay: RelayInfo, s: WireSensorSnapshot): SensorEntry {
  return {
    kind: 'sensor',
    id: s.id,
    relay,
    source: 'espectre',
    name: s.name,
    chip: s.chip,
    firmware: s.firmware,
    motionState: s.motionState,
    threshold: s.threshold,
    ready: s.ready,
    online: s.online,
    lastSeen: s.lastSeen,
  };
}

function isWireSensor(d: object): d is WireSensorSnapshot {
  return 'kind' in d && (d as { kind?: unknown }).kind === 'sensor';
}

export async function fetchDevices(): Promise<RelayResult<FleetEntry[]>> {
  const { oks, failed } = await fanout((relay) =>
    _fetch<{ devices: Array<WireDeviceSummary | WireSensorSnapshot> }>(relay, '/api/devices'),
  );
  return combine(oks, failed, (all) =>
    all.flatMap(({ relay, data }) =>
      data.devices.map((d) => (isWireSensor(d) ? sensorToEntry(relay, d) : summaryToEntry(relay, d))),
    ),
  );
}

async function fetchDeviceFrom(relay: RelayInfo, id: string): Promise<One<FleetEntry>> {
  const r = await _fetch<{ device: WireTelemetry | WireSensorSnapshot; recentSales?: WireSale[] }>(
    relay,
    `/api/devices/${encodeURIComponent(id)}`,
  );
  if (!r.ok) return r.reason === 'unimplemented' ? { ok: false, reason: 'not_found' } : r;
  const { device } = r.data;
  if (isWireSensor(device)) return { ok: true, data: sensorToEntry(relay, device) };
  const recentSales = r.data.recentSales ?? [];
  const earned = recentSales.reduce((s, x) => s + BigInt(x.amountMicroUsdc), BigInt(0));
  return {
    ok: true,
    data: {
      kind: 'vendor',
      id: device.deviceId,
      relay,
      source: device.source,
      url: device.url,
      nodeState: device.nodeState,
      reachable: device.reachable,
      chip: device.chip,
      deviceHash: device.deviceHash,
      freeHeap: device.freeHeap,
      largestBlock: device.largestBlock,
      lvglUsedPct: device.lvglUsedPct,
      bleState: device.bleState,
      bootCount: device.bootCount,
      resetReasons: device.resetReasons,
      taskCount: device.taskCount,
      fsBytes: device.fsBytes,
      lastSeen: device.timestamp,
      earningsMicroUsdc: earned.toString(),
      motion: device.motion,
      location: device.location,
      firmware: device.firmware,
      transport: device.transport,
      rssiDbm: device.rssiDbm,
      uptimeSeconds: device.uptimeSeconds,
      sensing: device.sensing,
    },
  };
}

/**
 * `id` is either `relayKey:deviceId` (what deviceHref emits) or a bare device
 * id, in which case every relay is asked and the first one that knows it wins.
 */
export async function fetchDevice(id: string): Promise<RelayResult<FleetEntry>> {
  const { relay, id: deviceId } = splitCompositeId(id);
  if (relay) {
    const r = await fetchDeviceFrom(relay, deviceId);
    return r.ok
      ? { ok: true, data: r.data, failed: [] }
      : { ok: false, reason: r.reason, message: r.message, failed: [{ relay, reason: r.reason, message: r.message }] };
  }
  const { oks, failed } = await fanout((rl) => fetchDeviceFrom(rl, deviceId));
  if (oks.length === 0) {
    // Every relay answered "unknown device" → not found. Any relay dark → say offline.
    const allNotFound = failed.every((f) => f.reason === 'not_found');
    return { ok: false, reason: allNotFound ? 'not_found' : (failed[0]?.reason ?? 'offline'), failed };
  }
  return { ok: true, data: oks[0].data, failed };
}

export async function fetchSales(): Promise<RelayResult<SaleEntry[]>> {
  // The sale record carries no device id, but each relay fronts exactly one
  // device, so its id is a fact we can look up rather than invent.
  const { oks, failed } = await fanout(async (relay) => {
    const [sales, devices] = await Promise.all([
      _fetch<{ sales: WireSale[] }>(relay, '/api/sales'),
      _fetch<{ devices: WireDeviceSummary[] }>(relay, '/api/devices'),
    ]);
    if (!sales.ok) return sales;
    const deviceId = devices.ok ? devices.data.devices[0]?.id ?? 'device' : 'device';
    return { ok: true as const, data: { sales: sales.data.sales, deviceId } };
  });
  return combine(oks, failed, (all) =>
    all
      .flatMap(({ relay, data }) =>
        data.sales.map<SaleEntry>((s) => ({
          id: s.id,
          relay,
          deviceId: data.deviceId,
          timestamp: s.timestamp,
          amount: s.amountMicroUsdc,
          signature: s.txSignature,
          resource: SALE_RESOURCE,
          description: SALE_DESCRIPTION,
          source: s.source,
          payer: s.payer,
          attributed: Boolean(s.agentId || s.userId),
        })),
      )
      .sort(byNewest),
  );
}

/**
 * The spend policy is the buyer agent's, and each relay reports the ledger on
 * its own machine, so there is one policy per relay — never summed.
 */
/** @param payer a logged-in wallet whose own spend today should ride along. */
export async function fetchPolicy(payer?: string): Promise<RelayResult<PolicyStatus[]>> {
  const path = payer ? `/api/policy?payer=${encodeURIComponent(payer)}` : '/api/policy';
  const { oks, failed } = await fanout((relay) => _fetch<WirePolicy>(relay, path));
  return combine(oks, failed, (all) =>
    all.map(({ relay, data: p }) => ({
      relay,
      dailyCapMicroUsdc: p.capMicroUsdc,
      spentMicroUsdc: p.spentMicroUsdc,
      remainingMicroUsdc: p.remainingMicroUsdc,
      date: p.date,
      payersVerified: p.payersVerified,
      wallet:
        p.payer && payer && p.payer.wallet === payer
          ? {
              wallet: p.payer.wallet,
              spentMicroUsdc: p.payer.spentMicroUsdc,
              remainingMicroUsdc: p.payer.remainingMicroUsdc,
              sales: p.payer.sales,
              lastSaleAt: p.payer.lastSaleAt,
            }
          : undefined,
      // Left undefined on purpose: the relay does not serve a denial log yet.
    })),
  );
}

/**
 * The ledger of settled payments. `/api/ledger` is a summary; the per-payment
 * entries are the settled sales, so we build the list from those and stamp
 * the ledger's network onto each.
 */
export async function fetchLedger(): Promise<RelayResult<LedgerEntry[]>> {
  const { oks, failed } = await fanout(async (relay) => {
    const [summary, sales, devices] = await Promise.all([
      _fetch<WireLedger>(relay, '/api/ledger'),
      _fetch<{ sales: WireSale[] }>(relay, '/api/sales'),
      _fetch<{ devices: WireDeviceSummary[] }>(relay, '/api/devices'),
    ]);
    if (!sales.ok) return sales;
    return {
      ok: true as const,
      data: {
        sales: sales.data.sales,
        network: summary.ok ? summary.data.network : 'solana-devnet',
        payTo: devices.ok ? devices.data.devices[0]?.id ?? '' : '',
      },
    };
  });
  return combine(oks, failed, (all) =>
    all
      .flatMap(({ relay, data }) =>
        data.sales.map<LedgerEntry & { timestamp: number }>((s) => ({
          relay,
          nonce: s.nonce,
          signature: s.txSignature,
          payTo: data.payTo,
          amount: s.amountMicroUsdc,
          network: data.network,
          issuedAt: s.timestamp,
          expiresAt: s.timestamp + 300,
          timestamp: s.timestamp,
        })),
      )
      .sort(byNewest)
      .map(({ timestamp: _t, ...e }) => e),
  );
}

/**
 * One live challenge, from the first relay (in configured order) that answers.
 * A challenge is an HTTP 402 by definition, so this is the one fetch where a
 * non-2xx status is the success case — `_fetch` would call it an error.
 */
async function _fetchChallenge(relay: RelayInfo): Promise<One<PaymentRequiredBody>> {
  try {
    const res = await fetch(`${relay.url}/api/telemetry`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (res.status !== 402) return { ok: false, reason: 'error', message: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as PaymentRequiredBody };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'offline', message: msg };
  }
}

export async function fetchChallenge(): Promise<
  RelayResult<{ relay: RelayInfo; challenge: PaymentRequiredBody }>
> {
  const { oks, failed } = await fanout(_fetchChallenge);
  return combine(oks, failed, (all) => ({ relay: all[0].relay, challenge: all[0].data }));
}
