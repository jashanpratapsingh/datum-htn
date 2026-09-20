import { capabilityOf, describeProvenance, type Provenance } from './provenance.js';

/**
 * The thing being sold.
 *
 * Shape is deliberately flat and small: it is the 200 response body, and on the
 * ESP32 it is built with `snprintf` (the firmware has no JSON library), so
 * nesting would cost code size for nothing.
 */

/** Motion bands, matching RuView's `MotionLevel` in wifi-densepose-wifiscan. */
export type MotionLevel = 'None' | 'Minimal' | 'Moderate' | 'High';

export interface TelemetryPayload {
  nodeId: number;
  resource: string;
  /** Unix milliseconds when the reading was taken. */
  observedAt: number;
  provenance: Provenance;
  /** Cumulative crossings in the current local day. A debounced heuristic. */
  footTraffic: number;
  presence: boolean;
  motionEnergy: number;
  motionLevel: MotionLevel;
  rssi: number;
  /** Instantaneous occupancy. Omitted at tiers that cannot support it. */
  nPersons?: number;
  /** Breaths per minute. CSI-only; needs ~20 Hz phase data. */
  breathingRate?: number;
  /** Access points that contributed to an RSSI reading. */
  bssidCount?: number;
  /** Shipped with the data so a buyer cannot claim it was oversold. */
  caveat: string;
}

/**
 * RuView's motion thresholds, ported from
 * `wifi-densepose-wifiscan/src/pipeline/motion_estimator.rs`.
 */
export const MOTION_THRESHOLD_MINIMAL = 0.02;
export const MOTION_THRESHOLD_MODERATE = 0.1;
export const MOTION_THRESHOLD_HIGH = 0.3;

export function motionLevelOf(energy: number): MotionLevel {
  if (energy < MOTION_THRESHOLD_MINIMAL) return 'None';
  if (energy < MOTION_THRESHOLD_MODERATE) return 'Minimal';
  if (energy < MOTION_THRESHOLD_HIGH) return 'Moderate';
  return 'High';
}

/** The honesty string that travels with every payload. */
export function caveatFor(p: Provenance): string {
  const cap = capabilityOf(p);
  const parts = [describeProvenance(p), 'footfall is a debounced motion heuristic, not a tripwire'];
  if (!cap.nPersons) parts.push('occupancy count withheld: unsupported at this tier');
  if (p !== 'MEASURED_CSI') parts.push('not camera-grade');
  return parts.join('; ');
}

/**
 * Drop fields the tier cannot honestly support, and attach the caveat.
 * Call this on every payload before it leaves the device.
 */
export function sealPayload(draft: Omit<TelemetryPayload, 'caveat'>): TelemetryPayload {
  const cap = capabilityOf(draft.provenance);
  const sealed: TelemetryPayload = { ...draft, caveat: caveatFor(draft.provenance) };
  if (!cap.nPersons) delete sealed.nPersons;
  if (!cap.breathingRate) delete sealed.breathingRate;
  return sealed;
}
