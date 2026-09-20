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

export interface EspectreSensorSnapshot {
  kind: 'sensor';
  id: string;
  source: 'espectre';
  name?: string;
  chip?: string;
  firmware?: string;
  url: string;
  motionState?: 'idle' | 'motion';
  threshold?: number;
  csiOccupancy?: number;
  ready?: boolean;
  online: boolean;
  /** Unix seconds of the most recent successful contact (mDNS or poll). */
  lastSeen: number;
}

interface DirectDeviceResource {
  device_id?: string;
  name?: string;
  chip?: string;
  firmware?: string;
}

interface DirectSensingResource {
  motion_state?: 'idle' | 'motion';
  threshold?: number;
  csi_occupancy?: number;
  ready?: boolean;
}

const sensors = new Map<string, EspectreSensorSnapshot>();
let bonjour: Bonjour | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function endpointFor(service: Service): string | undefined {
  const host = service.addresses?.find((a) => !a.includes(':')) ?? service.host;
  if (!host || !service.port) return undefined;
  return `http://${host}:${service.port}/espectre/v1`;
}

async function pollOne(id: string, baseUrl: string): Promise<void> {
  try {
    const [deviceRes, sensingRes] = await Promise.all([
      fetch(`${baseUrl}/device`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${baseUrl}/sensing`, { signal: AbortSignal.timeout(3000) }),
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
      motionState: sensing.motion_state,
      threshold: sensing.threshold,
      csiOccupancy: sensing.csi_occupancy,
      ready: sensing.ready,
      online: true,
      lastSeen: now(),
    });
  } catch {
    const prev = sensors.get(id);
    if (prev) sensors.set(id, { ...prev, online: false });
  }
}

function pollAll(): void {
  for (const [id, sensor] of sensors) {
    if (now() - sensor.lastSeen > LOST_AFTER_MS / 1000) {
      sensors.delete(id);
      continue;
    }
    void pollOne(id, sensor.url);
  }
}

function onServiceUp(service: Service): void {
  const url = endpointFor(service);
  if (!url) return;
  // The service name is `espectre-<device_id>`; fall back to the full name if unset.
  const id = service.name.replace(/^espectre-/, '');
  const existing = sensors.get(id);
  sensors.set(id, {
    kind: 'sensor',
    id,
    source: 'espectre',
    name: existing?.name,
    chip: existing?.chip,
    firmware: existing?.firmware,
    url,
    motionState: existing?.motionState,
    threshold: existing?.threshold,
    csiOccupancy: existing?.csiOccupancy,
    ready: existing?.ready,
    online: true,
    lastSeen: now(),
  });
  void pollOne(id, url);
}

function onServiceDown(service: Service): void {
  const id = service.name.replace(/^espectre-/, '');
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
  sensors.clear();
}
