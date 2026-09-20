/**
 * Auto-discovery of ESPectre motion-sensor devices on the LAN.
 *
 * These are not x402 vendor nodes (see node-registry.ts's design note on that
 * distinction) — they are plain WiFi-CSI motion sensors with no wallet, no
 * price, and nothing to sell. Forcing them into the vending-shaped device
 * schema would mean fabricating a price/payTo that doesn't exist, so they get
 * their own lightweight, ephemeral, in-memory registry instead.
 *
 * ESPectre firmware already advertises itself over mDNS as `_espectre._tcp`
 * and serves a Direct HTTP API on port 62587 (see espectre.dev SDK docs) —
 * no firmware change, no reflash, no manual IP entry required. This module
 * just browses for that service and polls whatever it finds.
 *
 * Never throws into the request path: discovery and polling both run off a
 * background timer, matching the pattern in heartbeat.ts.
 */

import { Bonjour, type Service } from 'bonjour-service';

const MDNS_TYPE = 'espectre';
const MDNS_PROTOCOL = 'tcp';
const POLL_INTERVAL_MS = Number(process.env.VENDX_ESPECTRE_POLL_MS ?? 20_000);
/** A sensor not seen (mDNS down + last poll failed) for this long drops out of the list. */
const LOST_AFTER_MS = 90_000;
/**
 * The firmware's Direct HTTP API 403s any request with no Origin header, or
 * one outside its allowlist (direct_http_service.h's default
 * `allowed_origins`). This is the SDK's own documented default origin — the
 * same one the espectre CLI sends — not something invented here.
 */
const DIRECT_API_ORIGIN = 'https://test.espectre.dev';

export interface EspectreSensorSnapshot {
  kind: 'sensor';
  id: string;
  source: 'espectre';
  name?: string;
  chip?: string;
  firmware?: string;
  url: string;
  /**
   * Only ever set from a `motion` event on the `/events` SSE stream — there is
   * no polled resource for current motion state (see docs/API.md's Events
   * section: "Threshold and detector metadata remain in `sensing`", the
   * live state does not).
   */
  motionState?: 'idle' | 'motion';
  threshold?: number;
  ready?: boolean;
  online: boolean;
  /** Unix seconds of the most recent successful contact (mDNS, poll, or event). */
  lastSeen: number;
}

interface DirectDeviceResource {
  device_id?: string;
  name?: string;
  chip?: string;
  firmware?: string;
}

/** Real fields per docs/API.md's `sensing` resource — no motion state here. */
interface DirectSensingResource {
  threshold?: number;
  ready?: boolean;
}

interface DirectMotionEvent {
  state?: 'idle' | 'motion';
}

const sensors = new Map<string, EspectreSensorSnapshot>();
/** One SSE connection per sensor for live motion state (firmware caps this at two clients total). */
const eventStreams = new Map<string, AbortController>();
let bonjour: Bonjour | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * `device_id` (16 lowercase hex chars) is the TXT record's stable identity —
 * docs/DISCOVERY.md: "the service instance and display name may use the
 * configured label, but consumers use device_id as identity." The instance
 * name (e.g. "PresenceNode C3 3d24a3") is a user-renameable label, not an id.
 */
function deviceIdFor(service: Service): string | undefined {
  const id = (service.txt as Record<string, string> | undefined)?.device_id;
  return id || undefined;
}

function endpointFor(service: Service): string | undefined {
  const host = service.addresses?.find((a) => !a.includes(':')) ?? service.host;
  const path = (service.txt as Record<string, string> | undefined)?.path || '/espectre/v1';
  if (!host || !service.port) return undefined;
  return `http://${host}:${service.port}${path}`;
}

async function pollOne(id: string, baseUrl: string): Promise<void> {
  try {
    const init: RequestInit = { signal: AbortSignal.timeout(3000), headers: { Origin: DIRECT_API_ORIGIN } };
    const [deviceRes, sensingRes] = await Promise.all([
      fetch(`${baseUrl}/device`, init),
      fetch(`${baseUrl}/sensing`, init),
    ]);
    if (!deviceRes.ok || !sensingRes.ok) throw new Error(`HTTP ${deviceRes.status}/${sensingRes.status}`);
    const device = (await deviceRes.json()) as DirectDeviceResource;
    const sensing = (await sensingRes.json()) as DirectSensingResource;
    const prev = sensors.get(id);
    sensors.set(id, {
      kind: 'sensor',
      id,
      source: 'espectre',
      name: device.name ?? prev?.name,
      chip: device.chip ?? prev?.chip,
      firmware: device.firmware ?? prev?.firmware,
      url: baseUrl,
      motionState: prev?.motionState,
      threshold: sensing.threshold,
      ready: sensing.ready,
      online: true,
      lastSeen: now(),
    });
    subscribeMotion(id, baseUrl);
  } catch {
    const prev = sensors.get(id);
    if (prev) sensors.set(id, { ...prev, online: false });
  }
}

function pollAll(): void {
  for (const [id, sensor] of sensors) {
    if (now() - sensor.lastSeen > LOST_AFTER_MS / 1000) {
      eventStreams.get(id)?.abort();
      eventStreams.delete(id);
      sensors.delete(id);
      continue;
    }
    void pollOne(id, sensor.url);
  }
}

/**
 * Holds one persistent SSE connection to `/events` per sensor and updates
 * `motionState` from each `motion` event. Reconnects on drop as long as the
 * sensor is still known; a stale-but-registered sensor just keeps its last
 * known motion state until `pollOne`/mDNS mark it offline.
 */
function subscribeMotion(id: string, baseUrl: string): void {
  if (eventStreams.has(id)) return;
  const controller = new AbortController();
  eventStreams.set(id, controller);
  runEventStream(id, baseUrl, controller.signal)
    .catch(() => {
      // Stream dropped (device reset, network blip, or eviction aborted it).
      // pollAll's /device + /sensing checks remain the source of truth for
      // online state; this must never escape as an unhandled rejection, or a
      // single sensor losing WiFi would take the whole relay down with it.
    })
    .finally(() => {
      eventStreams.delete(id);
      if (sensors.has(id)) {
        setTimeout(() => subscribeMotion(id, baseUrl), 5_000).unref();
      }
    });
}

async function runEventStream(id: string, baseUrl: string, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${baseUrl}/events`, {
    signal,
    headers: { Accept: 'text/event-stream', Origin: DIRECT_API_ORIGIN },
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let newlineAt: number;
    while ((newlineAt = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineAt).replace(/\r$/, '');
      buffer = buffer.slice(newlineAt + 1);
      if (line === '') {
        if (eventName === 'motion' && dataLines.length > 0) {
          try {
            const data = JSON.parse(dataLines.join('\n')) as DirectMotionEvent;
            const prev = sensors.get(id);
            if (prev && data.state) {
              sensors.set(id, { ...prev, motionState: data.state, online: true, lastSeen: now() });
            }
          } catch {
            // Malformed frame — drop it and keep the connection open.
          }
        }
        eventName = 'message';
        dataLines = [];
        continue;
      }
      if (line.startsWith(':')) continue; // SSE comment (heartbeat)
      const sep = line.indexOf(':');
      const field = sep === -1 ? line : line.slice(0, sep);
      let val = sep === -1 ? '' : line.slice(sep + 1);
      if (val.startsWith(' ')) val = val.slice(1);
      if (field === 'event') eventName = val;
      else if (field === 'data') dataLines.push(val);
    }
  }
}

function onServiceUp(service: Service): void {
  const url = endpointFor(service);
  const id = deviceIdFor(service);
  if (!url || !id) return;
  const txt = service.txt as Record<string, string> | undefined;
  const existing = sensors.get(id);
  sensors.set(id, {
    kind: 'sensor',
    id,
    source: 'espectre',
    name: txt?.name ?? existing?.name,
    chip: txt?.chip ?? existing?.chip,
    firmware: txt?.firmware ?? existing?.firmware,
    url,
    motionState: existing?.motionState,
    threshold: existing?.threshold,
    ready: existing?.ready,
    online: true,
    lastSeen: now(),
  });
  void pollOne(id, url);
}

function onServiceDown(service: Service): void {
  const id = deviceIdFor(service);
  if (!id) return;
  const existing = sensors.get(id);
  if (existing) sensors.set(id, { ...existing, online: false });
}

/** Returns every sensor currently known, discovered or not yet expired. */
export function getEspectreSensors(): EspectreSensorSnapshot[] {
  return [...sensors.values()];
}

export function getEspectreSensor(id: string): EspectreSensorSnapshot | undefined {
  return sensors.get(id);
}

export function startEspectreDiscovery(): void {
  if (bonjour) return;
  try {
    bonjour = new Bonjour();
    bonjour.find({ type: MDNS_TYPE, protocol: MDNS_PROTOCOL }, onServiceUp).on('down', onServiceDown);
  } catch (e) {
    console.error(`[relay-proxy] ESPectre mDNS discovery failed to start: ${(e as Error).message}`);
    bonjour = null;
    return;
  }
  pollTimer = setInterval(pollAll, POLL_INTERVAL_MS);
  pollTimer.unref();
}

export function stopEspectreDiscovery(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  bonjour?.destroy();
  bonjour = null;
  for (const controller of eventStreams.values()) controller.abort();
  eventStreams.clear();
  sensors.clear();
}
