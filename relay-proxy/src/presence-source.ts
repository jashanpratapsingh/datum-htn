/**
 * Real telemetry from an ESP32-C3 running the presence-node (ESPectre) firmware,
 * read over WiFi.
 *
 * The presence-node build has no serial console for badge.py to talk to; its
 * network face is a small HTTP API on TCP 62587 (see the presence-node docs,
 * `docs/API.md`: base path `/espectre/v1`, exact-Origin allowlist, motion only
 * on the `/events` SSE stream). So the relay polls resource snapshots and keeps
 * one SSE connection open for motion, and sells the result via x402 exactly the
 * way it sells the conference badge's console readings.
 *
 * Provenance: `source: 'esp32c3'` (the chip the reading came from, over its own
 * network face), plus `transport`, `firmware`, `readAt` and `ageSeconds` so a
 * consumer can see what it is and how fresh it is. Before the node has answered
 * once there is no reading — the caller falls back to the simulator, stamped so.
 *
 * Enabled by VENDX_PRESENCE_NODE=<host[:port]>. Never opens the serial port.
 */

import type { BadgeTelemetry } from './badge-source.js';

const NODE = process.env.VENDX_PRESENCE_NODE ?? '';
const DEFAULT_PORT = 62587;
/** The firmware accepts only exact allow-listed Origins; this is its default. */
const ORIGIN = process.env.VENDX_PRESENCE_ORIGIN ?? 'https://test.espectre.dev';
/** Where the node physically is, if the operator says so. Free text, optional. */
const LOCATION = process.env.VENDX_NODE_LOCATION;

const SNAPSHOT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 4_000;
/** The ESP-IDF httpd has a handful of sockets; reconnect slowly and one at a time. */
const SSE_RETRY_MS = 15_000;
const FAIL_BACKOFF_MS = 30_000;
/** A reading older than this is reported as unresponsive, not silently reused. */
const STALE_MS = 60_000;

export const PRESENCE_NODE = NODE
  ? `http://${NODE.includes(':') ? NODE : `${NODE}:${DEFAULT_PORT}`}/espectre/v1`
  : null;

export function presenceConfigured(): boolean {
  return PRESENCE_NODE !== null;
}

export interface MotionReading {
  /** `idle` or `motion`, as the node's detector reports it. */
  state: string;
  /** Detector score in [0, 1]; the node's threshold is in `sensing`. */
  score: number;
  /** Unix seconds when the relay received the event. */
  at: number;
}

interface Snapshot {
  deviceId: string;
  name: string;
  chip: string;
  firmware: string;
  uptimeSeconds?: number;
  rssiDbm?: number;
  wifiChannel?: number;
  sensing?: { enabled: boolean; ready: boolean; calibrating: boolean; threshold: number };
  readAt: number;
}

let lastSnapshot: Snapshot | null = null;
let lastMotion: MotionReading | null = null;
let lastFailureAt = 0;
let loopStarted = false;

async function getJson<T>(resource: string): Promise<T> {
  const res = await fetch(`${PRESENCE_NODE}/${resource}`, {
    // `Connection: close` so each snapshot request frees its socket on the node.
    headers: { Origin: ORIGIN, Connection: 'close' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${resource}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

let snapshotInFlight = false;

async function snapshotOnce(): Promise<void> {
  if (snapshotInFlight) return;
  if (lastFailureAt > 0 && Date.now() - lastFailureAt < FAIL_BACKOFF_MS) return;
  snapshotInFlight = true;
  try {
    // Sequential on purpose: one open socket to the node at a time.
    const device = await getJson<{ device_id: string; name: string; chip: string; firmware: string }>('device');
    const health = await getJson<{ uptime_s?: number }>('health');
    const wifi = await getJson<{ rssi_dbm?: number; channel?: number }>('wifi').catch(() => ({} as { rssi_dbm?: number; channel?: number }));
    const sensing = await getJson<{ enabled: boolean; ready: boolean; calibrating: boolean; threshold: number }>('sensing').catch(() => undefined);
    lastSnapshot = {
      deviceId: `${device.chip}-${device.device_id.slice(-6)}`,
      name: device.name,
      chip: device.chip,
      firmware: device.firmware,
      uptimeSeconds: health.uptime_s,
      rssiDbm: wifi.rssi_dbm,
      wifiChannel: wifi.channel,
      sensing: sensing
        ? { enabled: sensing.enabled, ready: sensing.ready, calibrating: sensing.calibrating, threshold: sensing.threshold }
        : undefined,
      readAt: Math.floor(Date.now() / 1000),
    };
    lastFailureAt = 0;
  } catch {
    lastFailureAt = Date.now();
  } finally {
    snapshotInFlight = false;
  }
}

/** One long-lived SSE connection; `motion` events are the only ones we keep. */
async function eventLoop(): Promise<void> {
  for (;;) {
    try {
      const res = await fetch(`${PRESENCE_NODE}/events`, { headers: { Origin: ORIGIN, Accept: 'text/event-stream' } });
      if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let event = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:') && event === 'motion') {
            try {
              const d = JSON.parse(line.slice(5)) as { state?: string; score?: number };
              if (typeof d.state === 'string' && typeof d.score === 'number') {
                lastMotion = { state: d.state, score: d.score, at: Math.floor(Date.now() / 1000) };
              }
            } catch {
              /* a malformed event is dropped, not fatal */
            }
          } else if (line === '') event = '';
        }
      }
    } catch {
      /* fall through to retry */
    }
    await new Promise((r) => setTimeout(r, SSE_RETRY_MS));
  }
}

function ensureLoop(): void {
  if (loopStarted || !PRESENCE_NODE) return;
  loopStarted = true;
  void snapshotOnce();
  const t = setInterval(() => void snapshotOnce(), SNAPSHOT_MS);
  if (typeof t.unref === 'function') t.unref();
  void eventLoop();
}

/**
 * The node's current telemetry, or null when no node is configured or it has
 * never answered. Never blocks on the network.
 */
export function readPresenceNode(): BadgeTelemetry | null {
  ensureLoop();
  if (!lastSnapshot) return null;
  const now = Math.floor(Date.now() / 1000);
  const age = now - lastSnapshot.readAt;
  const unresponsive = lastFailureAt > 0 && Date.now() - lastFailureAt < STALE_MS && age * 1000 > STALE_MS;
  return {
    deviceId: lastSnapshot.deviceId,
    timestamp: now,
    source: 'esp32c3',
    chip: lastSnapshot.chip,
    transport: 'wifi-http',
    firmware: lastSnapshot.firmware,
    nodeName: lastSnapshot.name,
    ...(LOCATION ? { location: LOCATION } : {}),
    uptimeSeconds: lastSnapshot.uptimeSeconds,
    rssiDbm: lastSnapshot.rssiDbm,
    wifiChannel: lastSnapshot.wifiChannel,
    sensing: lastSnapshot.sensing,
    motion: lastMotion ?? undefined,
    readAt: lastSnapshot.readAt,
    ageSeconds: age,
    badgeState: unresponsive ? 'unresponsive' : 'ok',
  };
}
