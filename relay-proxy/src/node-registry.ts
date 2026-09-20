/**
 * Registry of VENDX nodes: ESP32s running firmware-vendor/ that serve x402
 * themselves and mint their own challenge nonces.
 *
 * Why the relay needs this: /settle only signs receipts for nonces it can
 * account for. The simulator's nonces are in the relay's own store; a node's
 * are minted on the device and never seen here until the buyer presents one.
 * Registration is what turns "a nonce we have never heard of" into "a nonce
 * from a vendor we know, selling for a wallet and price we know". The
 * facilitator then verifies the on-chain transfer against the *registered*
 * payTo and price, never the buyer's copy — same trust shape as the simulator
 * path, with the node's registration standing in for the issued challenge.
 *
 * A node registers on every station connect and heartbeats after that
 * (firmware-vendor/src/main.cpp, `registerWithRelay`). The registry is
 * in-memory: a relay restart forgets nodes until their next heartbeat, which
 * is at most `heartbeatSec` away. Live nodes also ride along in the relay's
 * directory heartbeat (heartbeat.ts), and "one receipt per node nonce" is the
 * Store's job — sales are keyed by nonce, so a second settle of the same
 * node nonce fails as nonce_replayed even after a restart.
 *
 * Registration is a claim, not a proof. After accepting one the relay probes
 * the node's /health at the URL it gave (off the request path, bounded) and
 * records whether the URL answered as that device. `/api/devices` carries the
 * result as `nodeState` and `reachable`, so the site never shows a node as
 * live on the strength of a POST alone.
 */

export type NodeState = 'live' | 'stale' | 'lost';

export interface NodeRegistration {
  deviceId: string;
  source: 'esp32c3';
  chip?: string;
  /** Base URL an agent can reach the node at, e.g. http://192.168.4.1 */
  url: string;
  mdns?: string;
  resource: string;
  payTo: string;
  priceMicroUsdc: string;
  network: string;
  asset?: string;
  heartbeatSec: number;
  freeHeap?: number;
  largestBlock?: number;
  uptime?: number;
  rssi?: number;
  bucket?: number;
  firmware?: string;
  sdk?: string;
}

export interface NodeRecord extends NodeRegistration {
  /** Unix seconds of the first registration this relay saw. */
  firstSeen: number;
  /** Unix seconds of the latest registration or heartbeat. */
  lastSeen: number;
  /** Registrations + heartbeats received since the relay started. */
  heartbeats: number;
  /** Address the registration came from, for the log. */
  remoteAddress?: string;
  /** Last /health probe of the node's URL, if one has completed. */
  probe?: { at: number; ok: boolean; status?: number; detail?: string };
}

export interface NodeView extends NodeRecord {
  nodeState: NodeState;
  /** True when the last probe found the node's URL answering as this device. */
  reachable: boolean;
  /** Seconds since `lastSeen`. */
  ageSeconds: number;
}

const nodes = new Map<string, NodeRecord>();

const now = () => Math.floor(Date.now() / 1000);

const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type RegisterResult =
  | { ok: true; node: NodeView; isNew: boolean }
  | { ok: false; error: string; detail?: string };

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Validate a registration body and upsert the node. */
export function registerNode(body: unknown, remoteAddress?: string): RegisterResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_registration', detail: 'body must be an object' };
  const b = body as Record<string, unknown>;

  const deviceId = str(b.deviceId);
  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) return { ok: false, error: 'bad_registration', detail: 'deviceId' };
  if (b.source !== 'esp32c3') return { ok: false, error: 'bad_registration', detail: 'source must be "esp32c3"' };

  const url = str(b.url);
  if (!url || !/^http:\/\/[^\s/]+(\/[^\s]*)?$/.test(url)) return { ok: false, error: 'bad_registration', detail: 'url must be http://host[:port]' };

  const payTo = str(b.payTo);
  if (!payTo || !BASE58_RE.test(payTo)) return { ok: false, error: 'bad_registration', detail: 'payTo must be a base58 wallet owner' };

  const price = str(b.priceMicroUsdc);
  if (!price || !/^\d{1,18}$/.test(price) || BigInt(price) <= 0n) return { ok: false, error: 'bad_registration', detail: 'priceMicroUsdc' };

  const network = str(b.network);
  if (network !== 'solana-devnet' && network !== 'solana') return { ok: false, error: 'bad_registration', detail: 'network' };

  const heartbeatSec = Math.min(Math.max(num(b.heartbeatSec) ?? 60, 10), 3600);
  const t = now();
  const prev = nodes.get(deviceId);

  const rec: NodeRecord = {
    deviceId,
    source: 'esp32c3',
    chip: str(b.chip),
    url: url.replace(/\/+$/, ''),
    mdns: str(b.mdns),
    resource: str(b.resource) ?? '/api/telemetry',
    payTo,
    priceMicroUsdc: price,
    network,
    asset: str(b.asset),
    heartbeatSec,
    freeHeap: num(b.freeHeap),
    largestBlock: num(b.largestBlock),
    uptime: num(b.uptime),
    rssi: num(b.rssi),
    bucket: num(b.bucket),
    firmware: str(b.firmware),
    sdk: str(b.sdk),
    firstSeen: prev?.firstSeen ?? t,
    lastSeen: t,
    heartbeats: (prev?.heartbeats ?? 0) + 1,
    remoteAddress,
    // A changed URL invalidates the old probe; keep it otherwise until the next one lands.
    probe: prev && prev.url === url.replace(/\/+$/, '') ? prev.probe : undefined,
  };
  nodes.set(deviceId, rec);
  return { ok: true, node: view(rec), isNew: !prev };
}

function view(rec: NodeRecord): NodeView {
  const age = now() - rec.lastSeen;
  const nodeState: NodeState = age <= rec.heartbeatSec * 2 ? 'live' : age <= rec.heartbeatSec * 10 ? 'stale' : 'lost';
  return { ...rec, nodeState, reachable: rec.probe?.ok === true, ageSeconds: age };
}

export function listNodes(): NodeView[] {
  return [...nodes.values()].map(view).sort((a, b) => b.lastSeen - a.lastSeen);
}

export function getNode(deviceId: string): NodeView | undefined {
  const rec = nodes.get(deviceId);
  return rec ? view(rec) : undefined;
}

/** Fallback when a buyer settles without naming the device: match on wallet. Ambiguous → undefined. */
export function findNodeByPayTo(payTo: string): NodeView | undefined {
  const hits = [...nodes.values()].filter((n) => n.payTo === payTo);
  return hits.length === 1 ? view(hits[0]) : undefined;
}

/**
 * Ask the node's URL whether it is the device it claims to be. Bounded, off
 * the request path (callers do not await it in a handler), never throws.
 */
export async function probeNode(deviceId: string, timeoutMs = 3000): Promise<void> {
  const rec = nodes.get(deviceId);
  if (!rec) return;
  const at = now();
  try {
    const res = await fetch(`${rec.url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    let detail: string | undefined;
    let ok = false;
    if (res.ok) {
      const h = (await res.json().catch(() => null)) as { device?: unknown; source?: unknown } | null;
      ok = h?.device === deviceId && h?.source === 'esp32c3';
      if (!ok) detail = `answered as ${String(h?.device ?? '?')}/${String(h?.source ?? '?')}`;
    } else {
      detail = `HTTP ${res.status}`;
    }
    rec.probe = { at, ok, status: res.status, detail };
  } catch (e) {
    rec.probe = { at, ok: false, detail: (e as Error).message };
  }
}

/** Test hook: forget every node. */
export function _resetNodes(): void {
  nodes.clear();
}
