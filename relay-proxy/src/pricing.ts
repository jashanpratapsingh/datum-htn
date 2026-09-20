import { usdToMicroUsdc, type Provenance } from '@vendx/protocol';

/**
 * The sensor sets its own price.
 *
 * No human picks this number and no config file holds it. The node quotes each
 * 402 from its own conditions, and the reasoning travels with the quote so a
 * buyer (and a judge) can see why it costs what it costs.
 *
 * Three forces, all bounded:
 *
 *   novelty  Unsold time accumulates value. A reading covering ten minutes of
 *            unobserved foot traffic is worth more than one sold a second ago.
 *   demand   Classic surge. Repeated requests in a short window raise the price.
 *   quality  Confidence is priced in. More access points and a better sensing
 *            tier are worth more; a radio still learning its baseline is
 *            discounted hard, because it is close to guessing.
 *
 * The floor and ceiling are not decoration: an autonomous pricer with no bounds
 * will eventually quote $0 or $10,000 and take the demo with it.
 */

export interface PricingConfig {
  baseUsd?: number;
  floorUsd?: number;
  ceilingUsd?: number;
  /** Seconds of unsold time at which the novelty premium saturates. */
  noveltySaturationSec?: number;
  /** Window over which requests count towards demand. */
  demandWindowMs?: number;
  /** Requests in the window at which the demand multiplier saturates. */
  demandSaturationCount?: number;
}

export const DEFAULT_PRICING: Required<PricingConfig> = {
  baseUsd: 0.05,
  floorUsd: 0.01,
  ceilingUsd: 0.25,
  noveltySaturationSec: 600,
  demandWindowMs: 60_000,
  demandSaturationCount: 6,
};

export interface PricingInputs {
  now: number;
  /** Unix ms of the last completed sale, or null if never sold. */
  lastSaleAt: number | null;
  /** Unix ms timestamps of recent challenge requests. */
  recentRequests: readonly number[];
  bssidCount: number;
  provenance: Provenance;
  /** True while the radio is still learning its baseline. */
  warmingUp: boolean;
}

export interface Quote {
  /** Micro-USDC as a decimal string, ready for a 402 body. */
  microUsdc: string;
  usd: number;
  factors: {
    novelty: number;
    demand: number;
    quality: number;
  };
  /** Human-readable, for the 402 description and the demo transcript. */
  rationale: string;
  clamped: 'floor' | 'ceiling' | null;
}

function tierWeight(p: Provenance): number {
  switch (p) {
    case 'MEASURED_CSI':
      return 1.3; // amplitude and phase at 20 Hz: the real thing
    case 'MEASURED_RSSI':
      return 1.0; // real physics, coarse
    case 'SIMULATED':
      return 0.5; // honest discount for data nobody measured
  }
}

export function quote(inputs: PricingInputs, config: PricingConfig = {}): Quote {
  const cfg = { ...DEFAULT_PRICING, ...config };

  // Novelty: 1.0x immediately after a sale, up to 2.0x at saturation.
  const unsoldSec =
    inputs.lastSaleAt === null
      ? cfg.noveltySaturationSec
      : Math.max(0, (inputs.now - inputs.lastSaleAt) / 1000);
  const novelty = 1 + Math.min(1, unsoldSec / cfg.noveltySaturationSec);

  // Demand: 1.0x when idle, up to 1.8x under repeated interest.
  const cutoff = inputs.now - cfg.demandWindowMs;
  const recent = inputs.recentRequests.filter((t) => t >= cutoff).length;
  const demand = 1 + 0.8 * Math.min(1, recent / cfg.demandSaturationCount);

  // Quality: access point coverage times tier weight, heavily cut while warming.
  const coverage = Math.min(1, inputs.bssidCount / 12);
  let quality = (0.5 + 0.5 * coverage) * tierWeight(inputs.provenance);
  if (inputs.warmingUp) quality *= 0.4;

  const raw = cfg.baseUsd * novelty * demand * quality;

  let usd = raw;
  let clamped: 'floor' | 'ceiling' | null = null;
  if (usd < cfg.floorUsd) {
    usd = cfg.floorUsd;
    clamped = 'floor';
  } else if (usd > cfg.ceilingUsd) {
    usd = cfg.ceilingUsd;
    clamped = 'ceiling';
  }

  // Round to whole micro-USDC so the quote and the transfer agree exactly.
  const microUsdc = usdToMicroUsdc(usd);
  const settledUsd = Number(microUsdc) / 1e6;

  const rationale = [
    `novelty ${novelty.toFixed(2)}x (${Math.round(unsoldSec)}s unsold)`,
    `demand ${demand.toFixed(2)}x (${recent} req/min)`,
    `quality ${quality.toFixed(2)}x (${inputs.bssidCount} APs, ${inputs.provenance}${inputs.warmingUp ? ', warming up' : ''})`,
    clamped ? `clamped to ${clamped}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    microUsdc,
    usd: settledUsd,
    factors: { novelty, demand, quality },
    rationale,
    clamped,
  };
}
