/**
 * Where a telemetry number came from.
 *
 * This is not decoration. RuView's own firmware README states the person count
 * is "a slot-capacity heuristic, not a learned counter" and that presence
 * "**will** false-positive under strong RF interference". A buyer paying for
 * foot traffic is entitled to know which grade of sensing it got, so the tier
 * travels inside the paid payload and is committed to by the receipt.
 *
 * Never promote a tier without the evidence that tier requires.
 */
export type Provenance =
  /** Live per-BSSID RSSI off the host's own WiFi radio. Real physics, ~2 Hz,
   *  coarse: good for motion and presence, not for head counts. */
  | 'MEASURED_RSSI'
  /** ESP32-S3/C6 CSI at ~20 Hz: per-subcarrier amplitude and phase. Requires a
   *  board actually streaming, evidenced by a captured boot log. */
  | 'MEASURED_CSI'
  /** Generated. Used when no radio is available or a scan stalls. */
  | 'SIMULATED';

export const PROVENANCE_TIERS: readonly Provenance[] = [
  'MEASURED_CSI',
  'MEASURED_RSSI',
  'SIMULATED',
];

/** Human-readable, for the demo transcript and the dashboard. */
export function describeProvenance(p: Provenance): string {
  switch (p) {
    case 'MEASURED_CSI':
      return 'measured on ESP32 CSI (~20 Hz, amplitude + phase)';
    case 'MEASURED_RSSI':
      return 'measured on host WiFi RSSI (~2 Hz, coarse motion only)';
    case 'SIMULATED':
      return 'simulated (no radio available)';
  }
}

/** True only for tiers backed by a real radio reading a real room. */
export function isMeasured(p: Provenance): boolean {
  return p === 'MEASURED_CSI' || p === 'MEASURED_RSSI';
}

/**
 * What a payload may legitimately claim at each tier.
 *
 * RSSI at ~2 Hz cannot support a head count (ADR-022 calls it "insufficient for
 * any meaningful DensePose estimation"), so `nPersons` is withheld rather than
 * guessed. Breathing rate needs 20 Hz phase data and is CSI-only.
 */
export interface TierCapability {
  motion: boolean;
  presence: boolean;
  /** Cumulative crossings; a debounced heuristic at every tier. */
  footfall: boolean;
  /** Instantaneous occupancy estimate. */
  nPersons: boolean;
  breathingRate: boolean;
}

export function capabilityOf(p: Provenance): TierCapability {
  switch (p) {
    case 'MEASURED_CSI':
      return { motion: true, presence: true, footfall: true, nPersons: true, breathingRate: true };
    case 'MEASURED_RSSI':
      return { motion: true, presence: true, footfall: true, nPersons: false, breathingRate: false };
    case 'SIMULATED':
      return { motion: true, presence: true, footfall: true, nPersons: true, breathingRate: true };
  }
}
