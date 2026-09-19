/**
 * Real telemetry from a physically attached Hack the North ESP32-C3 badge.
 *
 * The badge cannot serve HTTP itself: its Lua app sandbox exposes no network
 * API (badge.radio is BLE-only), and with the BLE controller up it has ~28KB of
 * free heap and a 19KB largest block — not enough for TLS. So the relay is the
 * device's network face, reading real sensor values over the badge's serial
 * console and selling them via x402. See docs/BADGE.md.
 *
 * Falls back to the simulator when no badge is attached, so the demo always runs.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { makeTelemetry } from './simulator.js';

const exec = promisify(execFile);

const PY = process.env.VENDX_PY ?? '.venv-pio/bin/python';
const SCRIPT = process.env.VENDX_BADGE_SCRIPT ?? 'scripts/badge.py';
const PORT = process.env.VENDX_BADGE_PORT ?? '/dev/cu.usbmodem101';

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
  [k: string]: unknown;
}

let cached: { at: number; value: BadgeTelemetry } | null = null;
const TTL_MS = 8_000;

export function badgeAttached(): boolean {
  try {
    return existsSync(PORT);
  } catch {
    return false;
  }
}

/**
 * Read the badge. Serial access is slow (~6s: the console has to be
 * prompt-synced and `radio probe` brings the BLE controller up), so results are
 * cached briefly — otherwise a burst of paid requests would queue on one UART.
 */
export async function readBadge(): Promise<BadgeTelemetry> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;

  if (!badgeAttached()) {
    const sim = { ...makeTelemetry(), source: 'simulator' as const };
    return sim as BadgeTelemetry;
  }

  try {
    const { stdout } = await exec(PY, [SCRIPT, 'telemetry'], {
      timeout: 45_000,
      env: { ...process.env, VENDX_BADGE_PORT: PORT },
    });
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    const value: BadgeTelemetry = {
      deviceId: `htn-badge-${raw.device_hash ?? 'unknown'}`,
      timestamp: Math.floor(Date.now() / 1000),
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
    };
    cached = { at: now, value };
    return value;
  } catch (err) {
    // A wedged console must not take the marketplace down — degrade to the
    // simulator and say so in the payload rather than failing a paid request.
    return {
      ...(makeTelemetry() as unknown as BadgeTelemetry),
      source: 'simulator',
      degradedFrom: 'badge',
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    };
  }
}
