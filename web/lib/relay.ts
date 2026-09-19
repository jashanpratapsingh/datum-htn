import type { PaymentRequiredBody } from '@vendx/protocol';

export const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? 'http://localhost:3402';

export type RelayResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'offline' | 'not_found' | 'unimplemented' | 'error'; message?: string };

async function _fetch<T>(path: string, init?: RequestInit): Promise<RelayResult<T>> {
  try {
    const res = await fetch(`${RELAY_URL}${path}`, {
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

/* ------------------------------------------------------------------ *
   Page-facing types. These are what components consume.
 * ------------------------------------------------------------------ */

export interface DeviceEntry {
  id: string;
  source: 'badge' | 'simulator';
  chip?: string;
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

export interface SaleEntry {
  id: string;
  deviceId: string;
  timestamp: number;
  /** micro-USDC, decimal string */
  amount: string;
  signature: string;
  resource: string;
  description: string;
  source: 'badge' | 'simulator';
}

export interface PolicyStatus {
  dailyCapMicroUsdc: string;
  spentMicroUsdc: string;
  remainingMicroUsdc: string;
  date: string;
  /** Not served by the relay yet. Absent, not empty — the page must say so. */
  denials?: Array<{ timestamp: number; reason: string; amount: string; deviceId?: string }>;
}

export interface LedgerEntry {
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
  source: 'badge' | 'simulator';
  priceUsd: number;
  freeHeap: number | null;
  largestBlock: number | null;
  chip: string | null;
  lastSeen: number;
  totalSales: number;
  totalEarnedMicroUsdc: string;
}

interface WireTelemetry {
  deviceId: string;
  timestamp: number;
  source: 'badge' | 'simulator';
  chip?: string;
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
  source: 'badge' | 'simulator';
}

interface WirePolicy {
  capMicroUsdc: string;
  spentMicroUsdc: string;
  remainingMicroUsdc: string;
  date: string;
}

interface WireLedger {
  programId: string;
  network: string;
  deployed: boolean;
  totalBuckets: number;
  totalSettledMicroUsdc: string;
}

const map = <A, B>(r: RelayResult<A>, f: (a: A) => B): RelayResult<B> =>
  r.ok ? { ok: true, data: f(r.data) } : r;

/** Every sale is a telemetry read; the relay serves exactly one resource. */
const SALE_RESOURCE = '/api/telemetry';
const SALE_DESCRIPTION = 'telemetry read';

/* ------------------------------------------------------------------ *
   Accessors
 * ------------------------------------------------------------------ */

export async function fetchDevices(): Promise<RelayResult<DeviceEntry[]>> {
  const r = await _fetch<{ devices: WireDeviceSummary[] }>('/api/devices');
  return map(r, ({ devices }) =>
    devices.map((d) => ({
      id: d.id,
      source: d.source,
      chip: d.chip ?? undefined,
      freeHeap: d.freeHeap ?? undefined,
      largestBlock: d.largestBlock ?? undefined,
      lastSeen: d.lastSeen,
      earningsMicroUsdc: d.totalEarnedMicroUsdc,
      totalSales: d.totalSales,
      priceUsd: d.priceUsd,
    })),
  );
}

export async function fetchDevice(id: string): Promise<RelayResult<DeviceEntry>> {
  const r = await _fetch<{ device: WireTelemetry; recentSales: WireSale[] }>(
    `/api/devices/${encodeURIComponent(id)}`,
  );
  if (!r.ok) return r.reason === 'unimplemented' ? { ok: false, reason: 'not_found' } : r;
  const { device, recentSales } = r.data;
  const earned = recentSales.reduce((s, x) => s + BigInt(x.amountMicroUsdc), BigInt(0));
  return {
    ok: true,
    data: {
      id: device.deviceId,
      source: device.source,
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
    },
  };
}

export async function fetchSales(): Promise<RelayResult<SaleEntry[]>> {
  // The sale record carries no device id, but the relay fronts exactly one
  // device, so its id is a fact we can look up rather than invent.
  const [sales, devices] = await Promise.all([
    _fetch<{ sales: WireSale[] }>('/api/sales'),
    _fetch<{ devices: WireDeviceSummary[] }>('/api/devices'),
  ]);
  const deviceId = devices.ok ? devices.data.devices[0]?.id ?? 'device' : 'device';
  return map(sales, ({ sales }) =>
    [...sales]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((s) => ({
        id: s.id,
        deviceId,
        timestamp: s.timestamp,
        amount: s.amountMicroUsdc,
        signature: s.txSignature,
        resource: SALE_RESOURCE,
        description: SALE_DESCRIPTION,
        source: s.source,
      })),
  );
}

export async function fetchPolicy(): Promise<RelayResult<PolicyStatus>> {
  const r = await _fetch<WirePolicy>('/api/policy');
  return map(r, (p) => ({
    dailyCapMicroUsdc: p.capMicroUsdc,
    spentMicroUsdc: p.spentMicroUsdc,
    remainingMicroUsdc: p.remainingMicroUsdc,
    date: p.date,
    // Left undefined on purpose: the relay does not serve a denial log yet.
  }));
}

/**
 * The ledger of settled payments. `/api/ledger` is a summary; the per-payment
 * entries are the settled sales, so we build the list from those and stamp
 * the ledger's network onto each.
 */
export async function fetchLedger(): Promise<RelayResult<LedgerEntry[]>> {
  const [summary, sales, devices] = await Promise.all([
    _fetch<WireLedger>('/api/ledger'),
    _fetch<{ sales: WireSale[] }>('/api/sales'),
    _fetch<{ devices: WireDeviceSummary[] }>('/api/devices'),
  ]);
  if (!sales.ok) return sales;
  const network = summary.ok ? summary.data.network : 'solana-devnet';
  const payTo = devices.ok ? devices.data.devices[0]?.id ?? '' : '';
  return {
    ok: true,
    data: [...sales.data.sales]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((s) => ({
        nonce: s.nonce,
        signature: s.txSignature,
        payTo,
        amount: s.amountMicroUsdc,
        network,
        issuedAt: s.timestamp,
        expiresAt: s.timestamp + 300,
      })),
  };
}

export const fetchChallenge = () => _fetch<PaymentRequiredBody>('/api/telemetry');
