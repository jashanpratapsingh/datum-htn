/**
 * Real telemetry from a physically attached Hack the North ESP32-C3 badge.
 *
 * The badge cannot serve HTTP itself: its Lua app sandbox exposes no network
 * API (badge.radio is BLE-only), and with the BLE controller up it has ~28KB of
 * free heap and a 19KB largest block — not enough for TLS. So the relay is the
 * device's network face, reading real sensor values over the badge's serial
 * console and selling them via x402. See docs/BADGE.md.
 *
 * DESIGN RULE: serial never sits in the request path.
 *
 * A full console read takes 6–10s on a healthy badge (prompt sync, heap, radio
 * probe, snapshot, journal) and ~45s on a badge whose /dev node exists but whose
 * chip is asleep or unpowered. Pages fetch with a 5s timeout. So `readBadge()`
 * returns the last-known value immediately and a background loop refreshes it;
 * a dead badge is backed off rather than re-probed on every request. Provenance
 * stays honest: the payload carries `source`, `readAt` and `ageSeconds`, and
 * before the first successful read it is plainly the simulator.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { makeTelemetry } from './simulator.js';

const exec = promisify(execFile);

const PY = process.env.VENDX_PY ?? '.venv-pio/bin/python';
const SCRIPT = process.env.VENDX_BADGE_SCRIPT ?? 'scripts/badge.py';
const PORT = process.env.VENDX_BADGE_PORT ?? '/dev/cu.usbmodem101';
/** The serial device the poller watches; exported for the startup log. */
export const BADGE_PORT = PORT;

/** How long one console read may take before we call the badge unresponsive. */
const READ_TIMEOUT_MS = 20_000;
/** Refresh cadence while the badge is answering. */
const REFRESH_MS = 15_000;
/** After a failed read, wait this long before trying serial again. */
const DEAD_BACKOFF_MS = 60_000;

export interface BadgeTelemetry {
  deviceId: string;
  timestamp: number;
  source: 'badge' | 'simulator';
  chip?: string;
  /** SHA-256 prefix of the BLE MAC. The raw MAC is never published. */
  deviceHash?: string;
  freeHeap?: number;
  largestBlock?: number;
  lvglUsedPct?: number;
  bleState?: number;
  bootCount?: number;
  resetReasons?: Record<string, number>;
  taskCount?: number;
  /** Unix seconds of the console read this value came from. */
  readAt?: number;
  /** Seconds since `readAt`, so a consumer can judge staleness. */
  ageSeconds?: number;
  /** Set when a badge is plugged in but not answering. */
  badgeState?: 'ok' | 'unresponsive' | 'absent';
  [k: string]: unknown;
}

let lastGood: BadgeTelemetry | null = null;
let lastFailureAt = 0;
let inFlight: Promise<void> | null = null;
let loopStarted = false;

export function badgeAttached(): boolean {
  try {
    return existsSync(PORT);
  } catch {
    return false;
  }
}

async function readSerialOnce(): Promise<BadgeTelemetry> {
  const { stdout } = await exec(PY, [SCRIPT, 'telemetry'], {
    timeout: READ_TIMEOUT_MS,
    env: { ...process.env, VENDX_BADGE_PORT: PORT },
  });
  const raw = JSON.parse(stdout) as Record<string, unknown>;
  // badge.py prints a partial object with empty tasks/zero boots when the
  // console is silent. Treat that as a failed read, not a reading.
  if (!raw.sys_free && !raw.boot_count) throw new Error('console silent');
  const now = Math.floor(Date.now() / 1000);
  return {
    deviceId: `htn-badge-${raw.device_hash ?? 'unknown'}`,
    timestamp: now,
    source: 'badge',
    chip: raw.chip as string,
    deviceHash: raw.device_hash as string,
    freeHeap: raw.sys_free as number,
    largestBlock: raw.sys_largest as number,
    lvglUsedPct: raw.lv_used_pct as number,
    bleState: raw.radio_controller_state as number,
    bootCount: raw.boot_count as number,
    resetReasons: raw.reset_reasons as Record<string, number>,
    taskCount: Array.isArray(raw.tasks) ? raw.tasks.length : undefined,
    fsBytes: raw.fs_bytes as number,
    readAt: now,
    badgeState: 'ok',
  };
}

function refresh(): Promise<void> {
  if (inFlight) return inFlight;
  if (!badgeAttached()) return Promise.resolve();
  if (Date.now() - lastFailureAt < DEAD_BACKOFF_MS) return Promise.resolve();
  inFlight = readSerialOnce()
    .then((t) => {
      lastGood = t;
      lastFailureAt = 0;
    })
    .catch(() => {
      lastFailureAt = Date.now();
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function ensureLoop() {
  if (loopStarted) return;
  loopStarted = true;
  void refresh();
  const t = setInterval(() => void refresh(), REFRESH_MS);
  // Never keep the process alive just for polling.
  if (typeof t.unref === 'function') t.unref();
}

/**
 * Current telemetry, returned immediately.
 *
 * - Badge has answered at least once: the last good reading, with its age.
 * - Badge attached but never answered / currently dead: simulator, stamped so.
 * - No badge: simulator.
 */
export async function readBadge(): Promise<BadgeTelemetry> {
  ensureLoop();
  const now = Math.floor(Date.now() / 1000);

  if (lastGood) {
    const age = now - (lastGood.readAt ?? now);
    const dead = lastFailureAt > 0 && Date.now() - lastFailureAt < DEAD_BACKOFF_MS;
    return { ...lastGood, timestamp: now, ageSeconds: age, badgeState: dead ? 'unresponsive' : 'ok' };
  }

  const sim = { ...(makeTelemetry() as unknown as BadgeTelemetry), source: 'simulator' as const };
  return badgeAttached()
    ? { ...sim, degradedFrom: 'badge', badgeState: 'unresponsive' }
    : { ...sim, badgeState: 'absent' };
}
