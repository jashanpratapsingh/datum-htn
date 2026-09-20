/**
 * Directory heartbeat: this relay advertises itself and what it is selling,
 * so the marketplace can list every relay in the world, not just the one in
 * NEXT_PUBLIC_RELAY_URL. Liveness is derived by readers from `lastSeen`.
 *
 * Runs off the request path. Failures are recorded (and surface as
 * /health `status: degraded`), never thrown.
 */

import { readBadge } from './badge-source.js';
import { SETTLEMENT_MODE } from './facilitator.js';
import { getRelayIdentity } from './identity.js';
import { listNodes } from './node-registry.js';
import { VENDOR_WALLET, VENDOR_PRICE_USD } from './simulator.js';
import type { DeviceRow, RelayRow, Store } from './store/types.js';

export interface HeartbeatState {
  lastAt: number | null;
  ok: boolean;
  count: number;
  error?: string;
}

const state: HeartbeatState = { lastAt: null, ok: false, count: 0 };
let timer: NodeJS.Timeout | null = null;
let sweeper: NodeJS.Timeout | null = null;

export function getHeartbeatState(): HeartbeatState {
  return { ...state };
}

export function deviceState(lastSeen: number, nowSec = Math.floor(Date.now() / 1000)): 'live' | 'stale' | 'lost' {
  const age = nowSec - lastSeen;
  return age <= 90 ? 'live' : age <= 600 ? 'stale' : 'lost';
}

export async function heartbeatOnce(store: Store, port?: number): Promise<void> {
  const id = getRelayIdentity(port);
  const now = Math.floor(Date.now() / 1000);
  const telemetry = await readBadge();
  const relay: RelayRow = {
    id: id.relayId,
    label: id.label,
    publicUrl: id.publicUrl,
    vendorWallet: VENDOR_WALLET,
    network: 'solana-devnet',
    settlement: SETTLEMENT_MODE,
    facilitatorPubkey: id.facilitatorPubkey,
    version: id.version,
    lastSeen: now,
  };
  const device: DeviceRow = {
    relayId: id.relayId,
    id: telemetry.deviceId,
    source: telemetry.source,
    resource: '/api/telemetry',
    priceMicroUsdc: String(Math.round(VENDOR_PRICE_USD * 1e6)),
    payTo: VENDOR_WALLET,
    network: 'solana-devnet',
    chip: typeof telemetry.chip === 'string' ? telemetry.chip : undefined,
    stats: {
      freeHeap: telemetry.freeHeap ?? null,
      largestBlock: telemetry.largestBlock ?? null,
      badgeState: telemetry.badgeState ?? null,
      ageSeconds: telemetry.ageSeconds ?? null,
    },
    lastSeen: now,
  };
  // Registered nodes that are currently live. The store stamps every row's
  // last_seen with the heartbeat time, so a node that has stopped heartbeating
  // is left out rather than kept looking alive by the relay.
  const nodeRows: DeviceRow[] = listNodes()
    .filter((n) => n.nodeState === 'live')
    .map((n) => ({
      relayId: id.relayId,
      id: n.deviceId,
      source: n.source,
      resource: n.resource,
      priceMicroUsdc: n.priceMicroUsdc,
      payTo: n.payTo,
      network: n.network,
      chip: n.chip,
      url: n.url,
      heartbeatSec: n.heartbeatSec,
      stats: {
        freeHeap: n.freeHeap ?? null,
        largestBlock: n.largestBlock ?? null,
        reachable: n.reachable,
        ageSeconds: n.ageSeconds,
      },
      lastSeen: n.lastSeen,
    }));
  try {
    await store.heartbeat(relay, [device, ...nodeRows]);
    if (!state.ok && state.count > 0) console.log('[relay-proxy] heartbeat: recovered');
    state.ok = true;
    state.error = undefined;
  } catch (e) {
    const msg = (e as Error).message;
    if (state.ok || state.count === 0) console.error(`[relay-proxy] heartbeat failed: ${msg}`);
    state.ok = false;
    state.error = msg;
  } finally {
    state.lastAt = now;
    state.count++;
  }
}

export function startHeartbeat(store: Store, opts: { intervalSec?: number; port?: number } = {}): void {
  if (timer) return;
  const intervalSec = opts.intervalSec ?? Number(process.env.VENDX_HEARTBEAT_SEC ?? 30);
  void heartbeatOnce(store, opts.port);
  timer = setInterval(() => void heartbeatOnce(store, opts.port), intervalSec * 1000);
  timer.unref();
  // Expired nonces are kept for an hour so a late redemption fails as
  // nonce_expired rather than nonce_unknown; after that they are swept.
  sweeper = setInterval(() => {
    store.sweepExpiredNonces(3600).catch((e: unknown) => console.error(`[relay-proxy] nonce sweep failed: ${(e as Error).message}`));
  }, 5 * 60_000);
  sweeper.unref();
}

export function stopHeartbeat(): void {
  if (timer) clearInterval(timer);
  if (sweeper) clearInterval(sweeper);
  timer = null;
  sweeper = null;
}
