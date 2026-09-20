/**
 * One device's lifetime earnings, for the badge screens.
 *
 * The ESP32 badges poll GET /api/earnings and paint `display` verbatim, so the
 * number is formatted here (tested TypeScript) rather than in firmware. The
 * long-poll (`wait`) lets a screen update within a second of a settle while
 * making one HTTPS request every ~25 s instead of one every few seconds.
 *
 * Every successful /settle in this process calls `notifySale()`; waiters also
 * re-read the store every RECHECK_MS in case a sale for this device was
 * recorded by another path.
 */
import { EventEmitter } from 'node:events';
import { formatUsdDisplay } from '@vendx/protocol';
import type { Store } from './store/types.js';

export interface EarningsSnapshot {
  deviceId: string;
  totalSales: number;
  /** Sum of every sale recorded for this device, as a decimal string. */
  totalEarnedMicroUsdc: string;
  /** "$0.0012" — what the screen shows. */
  display: string;
  /** Unix seconds when this snapshot was computed. */
  updatedAt: number;
}

/** Same cap /api/devices lives with: the store lists at most this many sales. */
export const EARNINGS_SALES_CAP = 1000;
/** Longest a long-poll may hold the connection (well under cloudflared's 100 s). */
export const MAX_WAIT_MS = 30_000;
const RECHECK_MS = 2_000;

const bus = new EventEmitter();
bus.setMaxListeners(0);

export async function computeEarnings(store: Store, deviceId: string): Promise<EarningsSnapshot> {
  const sales = await store.listSales({ deviceId, limit: EARNINGS_SALES_CAP });
  const total = sales.reduce((sum, s) => sum + BigInt(s.amountMicroUsdc), 0n);
  return {
    deviceId,
    totalSales: sales.length,
    totalEarnedMicroUsdc: total.toString(),
    display: formatUsdDisplay(total),
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

/** Wake every long-poll waiting on this device (or on any device when the id is unknown). */
export function notifySale(deviceId: string | undefined): void {
  bus.emit('sale', deviceId ?? '');
}

function waitForSale(deviceId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    timer.unref();
    function onSale(id: string) {
      if (id === '' || id === deviceId) done();
    }
    function done() {
      clearTimeout(timer);
      bus.off('sale', onSale);
      resolve();
    }
    bus.on('sale', onSale);
  });
}

/** Clamp a `wait` query value (seconds) to what the relay will honour, in ms. */
export function waitMsFromQuery(raw: string | null): number {
  const sec = Number(raw ?? '0');
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.min(Math.round(sec * 1000), MAX_WAIT_MS);
}

/**
 * Resolve as soon as the device's total differs from `since`, or when `waitMs`
 * elapses. Always resolves with the current snapshot, never rejects on timeout,
 * so the firmware has one code path.
 */
export async function waitForEarningsChange(
  store: Store,
  deviceId: string,
  since: string | null,
  waitMs: number,
): Promise<EarningsSnapshot> {
  const deadline = Date.now() + Math.min(Math.max(waitMs, 0), MAX_WAIT_MS);
  let snap = await computeEarnings(store, deviceId);
  if (since === null || snap.totalEarnedMicroUsdc !== since) return snap;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return snap;
    await waitForSale(deviceId, Math.min(RECHECK_MS, remaining));
    snap = await computeEarnings(store, deviceId);
    if (snap.totalEarnedMicroUsdc !== since) return snap;
  }
}
