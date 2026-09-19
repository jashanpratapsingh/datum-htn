import { motionLevelOf, type MotionLevel } from '@vendx/protocol';
import type { BssidObservation } from './wifi-scan.js';

/**
 * Motion from WiFi signal strength.
 *
 * Structure is ported from RuView's `wifi-densepose-wifiscan`: an exponential
 * moving average per access point forms the "empty room" baseline, and what is
 * left after subtracting it is attributed to bodies moving through the paths
 * between the radio and the access points.
 *
 *   predictive_gate.rs   residual = amplitude - ema;  ema = a*amplitude + (1-a)*ema
 *   motion_estimator.rs  weighted mean of |residual|, EMA-smoothed, banded
 *
 * Two deliberate departures, because our input is not RuView's input:
 *
 * 1. **We work in dB, not linear amplitude.** `netsh` reports signal as whole
 *    percent, which is a 0.5 dB quantisation step. In linear amplitude one
 *    quantisation step near -60 dBm is a ~6% swing, which would saturate the
 *    bands immediately. In dB the step is uniform across the whole range.
 *
 * 2. **We add a coherence factor.** A person crossing the room perturbs many
 *    paths at once; a single flapping access point perturbs one. Scaling the
 *    energy by the fraction of access points that moved together rejects
 *    single-AP noise, which matters a lot in a crowded venue.
 *
 * `DB_SCALE` is chosen so RuView's published bands stay meaningful against dB
 * input: ~0.3 dB of mean deviation lands on the None/Minimal edge, ~1.5 dB on
 * Moderate, ~4.5 dB on High. That calibration is reasoned, NOT measured against
 * ground truth. Treat the bands as a heuristic, never as a validated detector.
 */

/** RuView's EMA smoothing constant, used for both baseline and output. */
export const EMA_ALPHA = 0.3;
/** Mean dB deviation that maps onto the top of the band range. */
export const DB_SCALE = 15;
/** Per-AP deviation below this is treated as measurement noise, not motion. */
export const PER_AP_NOISE_DB = 0.75;
/** One AP cannot contribute more than this, so a dropout cannot fake motion. */
export const MAX_RESIDUAL_DB = 12;
/** Samples needed before a baseline is trustworthy. */
export const WARMUP_SAMPLES = 8;
/** Coherence floor: even a single moving AP registers something. */
export const COHERENCE_FLOOR = 0.3;

export interface MotionReading {
  energy: number;
  level: MotionLevel;
  /** Access points that contributed to this reading. */
  apCount: number;
  /** Fraction of those that moved together, 0-1. */
  coherence: number;
  /** Mean absolute deviation from baseline, in dB. The physical quantity. */
  meanDeviationDb: number;
  /** True until the baseline has seen WARMUP_SAMPLES observations. */
  warmingUp: boolean;
  /** True when the input was byte-identical to the previous one. */
  stale: boolean;
  at: number;
}

export interface MotionEstimatorOptions {
  alpha?: number;
  dbScale?: number;
  warmupSamples?: number;
  /** Drop an access point's baseline after this long unseen. */
  forgetAfterMs?: number;
  /**
   * Treat a byte-identical repeat of the previous input as a cached scan and
   * ignore it.
   *
   * Correct for `netsh wlan show networks mode=bssid`, whose results the driver
   * caches for about ten seconds. WRONG for `show interfaces`, where the
   * connected AP genuinely reports a stable quantised RSSI second after second;
   * discarding those would starve the baseline and leave the estimator warming
   * up forever. So the fast channel sets this false.
   */
  dedupeIdentical?: boolean;
}

interface Baseline {
  emaDb: number;
  samples: number;
  lastSeen: number;
}

/**
 * One estimator over one stream of observations. The node runs two: a fast one
 * on the connected access point and a slow one on the full scan.
 */
export class MotionEstimator {
  private readonly baselines = new Map<string, Baseline>();
  private readonly alpha: number;
  private readonly dbScale: number;
  private readonly warmupSamples: number;
  private readonly forgetAfterMs: number;
  private readonly dedupeIdentical: boolean;
  private smoothedEnergy = 0;
  private lastFingerprint = '';

  constructor(opts: MotionEstimatorOptions = {}) {
    this.alpha = opts.alpha ?? EMA_ALPHA;
    this.dbScale = opts.dbScale ?? DB_SCALE;
    this.warmupSamples = opts.warmupSamples ?? WARMUP_SAMPLES;
    this.forgetAfterMs = opts.forgetAfterMs ?? 120_000;
    this.dedupeIdentical = opts.dedupeIdentical ?? true;
  }

  get trackedAps(): number {
    return this.baselines.size;
  }

  /**
   * Feed one scan. Returns the motion reading it produced.
   *
   * A scan identical to the previous one is reported `stale` and does NOT
   * update the baseline. The Windows driver caches scan results for about ten
   * seconds, so without this the baseline would converge onto the cached value
   * and report "no motion" with false confidence.
   */
  update(observations: BssidObservation[], at: number = Date.now()): MotionReading {
    const fingerprint = observations
      .map((o) => `${o.bssid}:${o.rssiDbm}`)
      .sort()
      .join('|');

    const stale = this.dedupeIdentical && fingerprint !== '' && fingerprint === this.lastFingerprint;
    if (stale) {
      return {
        energy: this.smoothedEnergy,
        level: motionLevelOf(this.smoothedEnergy),
        apCount: this.establishedAps(),
        coherence: 0,
        meanDeviationDb: 0,
        warmingUp: this.isWarmingUp(),
        stale: true,
        at,
      };
    }
    this.lastFingerprint = fingerprint;

    this.forget(at);

    let deviationSum = 0;
    let moved = 0;
    let counted = 0;

    for (const obs of observations) {
      const prior = this.baselines.get(obs.bssid);
      if (!prior) {
        this.baselines.set(obs.bssid, { emaDb: obs.rssiDbm, samples: 1, lastSeen: at });
        continue; // No baseline yet, so no opinion about motion.
      }

      const deviation = Math.min(Math.abs(obs.rssiDbm - prior.emaDb), MAX_RESIDUAL_DB);
      if (prior.samples >= this.warmupSamples) {
        deviationSum += deviation;
        if (deviation > PER_AP_NOISE_DB) moved++;
        counted++;
      }

      prior.emaDb = this.alpha * obs.rssiDbm + (1 - this.alpha) * prior.emaDb;
      prior.samples++;
      prior.lastSeen = at;
    }

    const meanDeviationDb = counted > 0 ? deviationSum / counted : 0;
    const coherence = counted > 0 ? moved / counted : 0;
    const raw =
      (meanDeviationDb / this.dbScale) * (COHERENCE_FLOOR + (1 - COHERENCE_FLOOR) * coherence);

    // Smooth the output the same way RuView does, so a single odd scan cannot
    // spike the band.
    this.smoothedEnergy = this.alpha * raw + (1 - this.alpha) * this.smoothedEnergy;

    return {
      energy: this.smoothedEnergy,
      level: motionLevelOf(this.smoothedEnergy),
      apCount: counted,
      coherence,
      meanDeviationDb,
      warmingUp: this.isWarmingUp(),
      stale: false,
      at,
    };
  }

  /** Access points whose baseline is settled enough to judge motion against. */
  private establishedAps(): number {
    let n = 0;
    for (const b of this.baselines.values()) {
      if (b.samples >= this.warmupSamples) n++;
    }
    return n;
  }

  private isWarmingUp(): boolean {
    if (this.baselines.size === 0) return true;
    for (const b of this.baselines.values()) {
      if (b.samples >= this.warmupSamples) return false;
    }
    return true;
  }

  private forget(now: number): void {
    for (const [bssid, b] of this.baselines) {
      if (now - b.lastSeen > this.forgetAfterMs) this.baselines.delete(bssid);
    }
  }
}

/**
 * Fuse the fast single-AP channel with the slow multi-AP channel.
 *
 * Taking the max means either channel can raise the alarm: the connected AP
 * gives sub-second latency, the full scan gives spatial coverage. A reading
 * still warming up or stale never wins, so a cached scan cannot mask real
 * motion nor invent it.
 */
export function fuseMotion(
  fast: MotionReading | null,
  slow: MotionReading | null,
): MotionReading | null {
  const usable = [fast, slow].filter(
    (r): r is MotionReading => r !== null && !r.warmingUp && !r.stale,
  );
  if (usable.length === 0) {
    // Nothing trustworthy; surface whichever exists so callers see the state.
    return fast ?? slow;
  }

  let best = usable[0]!;
  for (const r of usable) if (r.energy > best.energy) best = r;

  const apCount = (fast?.apCount ?? 0) + (slow?.apCount ?? 0);
  return { ...best, apCount };
}
