/**
 * VENDX wire types.
 *
 * These follow the CANONICAL x402 v1 shape (github.com/x402-foundation/x402),
 * not `@x402-solana/*`. That choice is deliberate and is documented in
 * docs/PROTOCOL.md — the short version is that `@x402-solana/core@0.3.2`
 * hardcodes a third-party test mint and would reject Circle's real devnet USDC.
 */

/** x402 protocol version this implementation speaks. */
export const X402_VERSION = 1 as const;

/** CAIP-ish network ids, canonical x402 v1 spelling. */
export type VendxNetwork = 'solana-devnet' | 'solana';

/** Circle's official devnet USDC mint, verified on-chain. */
export const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DECIMALS = 6;

export function usdcMintFor(network: VendxNetwork): string {
  return network === 'solana' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}

/**
 * One acceptable way to pay, as advertised in a 402 body.
 * `payTo` is the recipient WALLET owner — the payer derives the ATA. This is
 * canonical x402 behaviour and the opposite of @x402-solana, which puts the
 * ATA here.
 */
export interface PaymentRequirements {
  scheme: 'exact';
  network: VendxNetwork;
  /** Smallest unit (micro-USDC), as a decimal string. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema?: unknown | null;
  /** Recipient wallet owner (base58), NOT the associated token account. */
  payTo: string;
  maxTimeoutSeconds: number;
  /** SPL mint address (base58). */
  asset: string;
  extra?: Record<string, unknown> | null;
}

/** The JSON body served with HTTP 402. */
export interface PaymentRequiredBody {
  x402Version: typeof X402_VERSION;
  error: string;
  accepts: PaymentRequirements[];
  /** VENDX extension: single-use challenge nonce, hex. */
  nonce: string;
  /** VENDX extension: unix seconds after which `nonce` is dead. */
  expiresAt: number;
}

/** Decoded contents of the `X-PAYMENT` request header. */
export interface PaymentPayload {
  x402Version: typeof X402_VERSION;
  scheme: 'exact';
  network: VendxNetwork;
  payload: {
    /** Signature of an already-settled Solana transaction (base58). */
    signature: string;
    /** Echoes the nonce from the challenge this pays for. */
    nonce: string;
  };
}

/** Decoded contents of the `X-PAYMENT-RESPONSE` header. */
export interface SettleResponse {
  success: boolean;
  transaction: string | null;
  network: VendxNetwork;
  payer: string | null;
  errorReason?: string;
}

/**
 * A facilitator-signed receipt.
 *
 * This is the VENDX extension that makes on-device verification tractable. The
 * relay settles and checks the transfer on-chain, then signs this blob with its
 * long-lived Ed25519 key. The ESP32 holds only the 32-byte public key and can
 * verify offline in ~30-60ms — no TLS, no RPC, no heap spike.
 */
export interface SignedReceipt {
  /** Base64url of the canonical JSON of `ReceiptBody`. */
  body: string;
  /** Base64url Ed25519 signature over the raw bytes of `body`. */
  sig: string;
}

export interface ReceiptBody {
  v: 1;
  /** The challenge nonce this receipt discharges. */
  nonce: string;
  /** Vendor wallet that was paid (base58). */
  payTo: string;
  /** Micro-USDC actually transferred. */
  amount: string;
  /** Settled transaction signature (base58). */
  signature: string;
  network: VendxNetwork;
  /** Unix seconds; the device rejects receipts older than its skew window. */
  issuedAt: number;
  expiresAt: number;
}

export type VerifyFailure =
  | 'missing_header'
  | 'malformed_header'
  | 'bad_signature'
  | 'nonce_unknown'
  | 'nonce_replayed'
  | 'nonce_expired'
  | 'wrong_recipient'
  | 'insufficient_amount'
  | 'wrong_network'
  | 'receipt_expired';

export interface VerifyResult {
  ok: boolean;
  reason?: VerifyFailure;
  receipt?: ReceiptBody;
}
