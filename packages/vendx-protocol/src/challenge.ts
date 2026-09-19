import { randomBytes } from 'node:crypto';
import {
  X402_VERSION,
  USDC_DECIMALS,
  usdcMintFor,
  type PaymentRequiredBody,
  type PaymentRequirements,
  type VendxNetwork,
} from './types.js';

export interface ChallengeInput {
  resource: string;
  description: string;
  /** Price in whole USD, e.g. 0.01 */
  priceUsd: number;
  payTo: string;
  network?: VendxNetwork;
  ttlSeconds?: number;
}

/** USD -> micro-USDC, as an integer decimal string. Rounds half-up. */
export function usdToMicroUsdc(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) throw new RangeError(`bad price: ${usd}`);
  return Math.round(usd * 10 ** USDC_DECIMALS).toString();
}

export function microUsdcToUsd(micro: string | number): number {
  return Number(micro) / 10 ** USDC_DECIMALS;
}

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Build the JSON body served with a 402. */
export function buildChallenge(input: ChallengeInput): PaymentRequiredBody {
  const network = input.network ?? 'solana-devnet';
  const ttl = input.ttlSeconds ?? 300;
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network,
    maxAmountRequired: usdToMicroUsdc(input.priceUsd),
    resource: input.resource,
    description: input.description,
    mimeType: 'application/json',
    outputSchema: null,
    payTo: input.payTo,
    maxTimeoutSeconds: ttl,
    asset: usdcMintFor(network),
    extra: null,
  };
  return {
    x402Version: X402_VERSION,
    error: 'Payment Required',
    accepts: [requirements],
    nonce: newNonce(),
    expiresAt: Math.floor(Date.now() / 1000) + ttl,
  };
}

/**
 * Pick an acceptable payment option.
 *
 * Unlike @x402-solana's client, which blindly takes accepts[0], this scans for
 * the first entry the caller can actually satisfy. A vendor may legitimately
 * offer several assets or networks.
 */
export function selectRequirements(
  body: PaymentRequiredBody,
  opts: { network: VendxNetwork; asset: string; maxMicroUsdc: bigint },
): PaymentRequirements | null {
  for (const r of body.accepts ?? []) {
    if (r.scheme !== 'exact') continue;
    if (r.network !== opts.network) continue;
    if (r.asset !== opts.asset) continue;
    if (BigInt(r.maxAmountRequired) > opts.maxMicroUsdc) continue;
    return r;
  }
  return null;
}
