import {
  decodeVitals,
  encodeVitals,
  motionLevelOf,
  sealPayload,
  type MotionLevel,
  type Provenance,
  type TelemetryPayload,
} from '@vendx/protocol';

import { FootfallCounter } from './footfall.js';
import { MotionEstimator, fuseMotion, type MotionReading } from './motion.js';
import { scanBssids, scanConnectedAp, wifiScanSupported } from './wifi-scan.js';

/**
 * The sensor: one interface, three possible sources.
 *
 * Readings always leave here as a real 32-byte RuView `edge_vitals_pkt_t`, which
 * is then decoded back before being shaped into JSON. That round trip looks
 * redundant and is not — it means the byte path the ESP32 will use is exercised
 * on every single read, so swapping in real hardware cannot silently break the
 * format.
 *
 * The tier demotes itself honestly. If the host has no WiFi scanning, or the
 * radio turns out to be frozen, the sensor says `SIMULATED` rather than dressing
 * up a guess as a measurement.
 */

export interface SensorOptions {
  nodeId?: number;
  resource?: string;
  /** Poll interval for the connected AP: fast, live from the driver. */
  fastIntervalMs?: number;
  /** Poll interval for the full scan: slow, driver caches ~10s. */
  slowIntervalMs?: number;
  /** Force a tier instead of auto-detecting. Useful for the demo and tests. */
  forceProvenance?: Provenance;
  /**
   * If the radio produces no trustworthy reading for this long, fall back to
   * SIMULATED rather than serving nothing.
   */
  fallbackAfterMs?: number;
}

export interface SensorStatus {
  provenance: Provenance;
  bssidCount: number;
  warmingUp: boolean;
  motionEnergy: number;
  motionLevel: MotionLevel;
  footfallToday: number;
  rejectedImpulses: number;
  /** Why the sensor is on the tier it is on. */
  note: string;
}

export class Sensor {
  private readonly nodeId: number;
  private readonly resource: string;
  private readonly fastIntervalMs: number;
  private readonly slowIntervalMs: number;
  private readonly forced: Provenance | undefined;
  private readonly fallbackAfterMs: number;

  private readonly fast = new MotionEstimator({ dedupeIdentical: false });
  private readonly slow = new MotionEstimator({ dedupeIdentical: true });
  private readonly footfall = new FootfallCounter();

  private lastFast: MotionReading | null = null;
  private lastSlow: MotionReading | null = null;
  private lastGoodAt = 0;
  private lastRssi = -70;
  private timers: NodeJS.Timeout[] = [];
  private simPhase = Math.random() * Math.PI * 2;
  private note = 'not started';
  private esp32SeenAt = 0;

  constructor(opts: SensorOptions = {}) {
    this.nodeId = opts.nodeId ?? 1;
    this.resource = opts.resource ?? '/api/telemetry';
    this.fastIntervalMs = opts.fastIntervalMs ?? 1_000;
    this.slowIntervalMs = opts.slowIntervalMs ?? 8_000;
    this.forced = opts.forceProvenance;
    this.fallbackAfterMs = opts.fallbackAfterMs ?? 25_000;
  }

  /** Begin polling the radio. Safe to call when no radio exists. */
  start(): void {
    if (this.forced === 'SIMULATED' || !wifiScanSupported()) {
      this.note = this.forced
        ? 'tier forced to SIMULATED'
        : `no WiFi scanning on ${process.platform}`;
      this.tickSimulated();
      this.timers.push(setInterval(() => this.tickSimulated(), this.fastIntervalMs));
      return;
    }

    this.note = 'reading host WiFi radio';
    this.timers.push(
      setInterval(() => {
        void scanConnectedAp()
          .then((r) => {
            const ap = r.observations[0];
            if (ap) this.lastRssi = ap.rssiDbm;
            this.lastFast = this.fast.update(r.observations);
            this.settle();
          })
          .catch(() => undefined);
      }, this.fastIntervalMs),
    );
    this.timers.push(
      setInterval(() => {
        void scanBssids()
          .then((r) => {
            this.lastSlow = this.slow.update(r.observations);
            this.settle();
          })
          .catch(() => undefined);
      }, this.slowIntervalMs),
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Feed a decoded ESP32 vitals packet. Promotes the tier to MEASURED_CSI. */
  ingestEsp32(packet: Uint8Array): boolean {
    const v = decodeVitals(packet);
    if (!v) return false;
    this.lastRssi = v.rssi;
    this.lastGoodAt = Date.now();
    this.esp32SeenAt = Date.now();
    this.lastFast = {
      energy: v.motionEnergy,
      level: motionLevelOf(v.motionEnergy),
      apCount: 1,
      coherence: 1,
      meanDeviationDb: 0,
      warmingUp: false,
      stale: false,
      at: Date.now(),
    };
    this.footfall.observe(v.motionEnergy);
    this.note = 'ESP32 streaming on UDP 5005';
    return true;
  }

  private settle(): void {
    const fused = fuseMotion(this.lastFast, this.lastSlow);
    if (fused && !fused.warmingUp && !fused.stale) {
      this.lastGoodAt = fused.at;
      this.footfall.observe(fused.energy);
    }
  }

  /** Drive the simulated source one step. */
  private tickSimulated(): void {
    this.simPhase += 0.08;
    // A retail-ish rhythm: quiet stretches punctuated by bursts of passers-by.
    const burst = Math.sin(this.simPhase) > 0.72 ? 0.22 : 0.0;
    const jitter = Math.random() * 0.02;
    const energy = burst + jitter;
    this.lastFast = {
      energy,
      level: motionLevelOf(energy),
      apCount: 0,
      coherence: burst > 0 ? 1 : 0,
      meanDeviationDb: energy * 15,
      warmingUp: false,
      stale: false,
      at: Date.now(),
    };
    this.lastGoodAt = Date.now();
    this.footfall.observe(energy);
  }

  /** Which tier can this sensor honestly claim right now? */
  provenance(): Provenance {
    if (this.forced) return this.forced;
    if (Date.now() - this.esp32SeenAt < 5_000) return 'MEASURED_CSI';
    if (!wifiScanSupported()) return 'SIMULATED';
    const fused = fuseMotion(this.lastFast, this.lastSlow);
    if (!fused) return 'SIMULATED';
    if (Date.now() - this.lastGoodAt > this.fallbackAfterMs) return 'SIMULATED';
    return 'MEASURED_RSSI';
  }

  status(): SensorStatus {
    const fused = fuseMotion(this.lastFast, this.lastSlow);
    const f = this.footfall.state();
    const provenance = this.provenance();
    let note = this.note;
    if (provenance === 'SIMULATED' && this.note === 'reading host WiFi radio') {
      note = 'radio produced no trustworthy reading; fell back to SIMULATED';
    }
    return {
      provenance,
      bssidCount: fused?.apCount ?? 0,
      warmingUp: fused?.warmingUp ?? true,
      motionEnergy: fused?.energy ?? 0,
      motionLevel: fused?.level ?? 'None',
      footfallToday: f.today,
      rejectedImpulses: f.rejectedImpulses,
      note,
    };
  }

  /**
   * Produce the payload that gets sold.
   *
   * Goes out through the real RuView packet layout and back, so the wire format
   * is exercised on every read rather than only when hardware is attached.
   */
  read(): TelemetryPayload {
    const s = this.status();
    const presence = s.motionEnergy >= 0.02;

    const packet = encodeVitals({
      nodeId: this.nodeId,
      presence,
      fall: false,
      motion: s.motionEnergy >= 0.1,
      breathingRate: 0,
      heartRate: 0,
      rssi: this.lastRssi,
      nPersons: presence ? 1 : 0,
      motionEnergy: s.motionEnergy,
      presenceScore: Math.min(1, s.motionEnergy * 3),
      timestampMs: Date.now() % 0xffffffff,
    });

    const v = decodeVitals(packet);
    if (!v) throw new Error('vitals packet failed to round-trip; wire format is broken');

    return sealPayload({
      nodeId: v.nodeId,
      resource: this.resource,
      observedAt: Date.now(),
      provenance: s.provenance,
      footTraffic: s.footfallToday,
      presence: v.presence,
      motionEnergy: Number(v.motionEnergy.toFixed(4)),
      motionLevel: motionLevelOf(v.motionEnergy),
      rssi: v.rssi,
      nPersons: v.nPersons,
      ...(s.bssidCount > 0 ? { bssidCount: s.bssidCount } : {}),
    });
  }
}
