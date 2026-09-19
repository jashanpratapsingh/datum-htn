import type { PaymentRequiredBody } from '@vendx/protocol';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? 'http://localhost:3402';

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
    if (res.status === 404) {
      // Relay is up but endpoint not implemented yet
      return { ok: false, reason: 'unimplemented' };
    }
    if (!res.ok) return { ok: false, reason: 'error', message: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'offline', message: msg };
  }
}

// ---- typed accessors ----

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
}

export interface SaleEntry {
  id: string;
  deviceId: string;
  timestamp: number;
  amount: string;
  resource: string;
  description: string;
  source: 'badge' | 'simulator';
}

export interface PolicyStatus {
  dailyCapMicroUsdc: string;
  spentMicroUsdc: string;
  remainingMicroUsdc: string;
  date: string;
  denials: Array<{ timestamp: number; reason: string; amount: string; deviceId?: string }>;
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

export const fetchDevices = () => _fetch<DeviceEntry[]>('/api/devices');
export const fetchDevice = (id: string) => _fetch<DeviceEntry>(`/api/devices/${id}`);
export const fetchSales = () => _fetch<SaleEntry[]>('/api/sales');
export const fetchPolicy = () => _fetch<PolicyStatus>('/api/policy');
export const fetchLedger = () => _fetch<LedgerEntry[]>('/api/ledger');
export const fetchChallenge = () => _fetch<PaymentRequiredBody>('/api/telemetry');
export const fetchHealth = () => _fetch<{ status: string; mode: string }>('/health');
