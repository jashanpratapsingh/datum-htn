import { decodeReceipt, verifyReceipt } from './codec.js';
import type { NonceStore } from './nonce.js';
import type {
  ReceiptBody,
  VendxNetwork,
  VerifyFailure,
  VerifyResult,
} from './types.js';

/**
 * The bouncer.
 *
 * This is the reference implementation of what the ESP32 does in C. Both sides
 * must agree on the checks AND on their order, so the firmware is verified
 * against the vectors this file's behaviour defines.
 *
 * Two ordering rules matter and are easy to get wrong:
 *
 *  1. The signature is verified over the raw transmitted body text BEFORE any
 *     field inside the body is read. Parsing first and verifying second would
 *     mean acting on attacker-controlled data.
 *
 *  2. The nonce is burned only after every other check passes. Burning earlier
 *     would let anyone spend a victim's nonce by sending a receipt that fails a
 *     later check.
 */

export const DEFAULT_CLOCK_SKEW_SECONDS = 120;

export interface VerifyPolicy {
  /** The facilitator's 32-byte Ed25519 public key. */
  facilitatorPubkey: Uint8Array;
  /** This device's wallet. A receipt paying anyone else is rejected. */
  payTo: string;
  /** Minimum acceptable payment, micro-USDC as a decimal string. */
  priceMicroUsdc: string;
  network: VendxNetwork;
  /** The device's ticket stub book. */
  nonces: NonceStore;
  /** Tolerance for the device clock disagreeing with the facilitator's. */
  clockSkewSeconds?: number;
  /** Injectable clock, unix seconds. */
  now?: () => number;
}

function fail(reason: VerifyFailure): VerifyResult {
  return { ok: false, reason };
}

/** Is this a plausible ReceiptBody, structurally? Checked post-signature. */
function isReceiptBody(v: unknown): v is ReceiptBody {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    b['v'] === 1 &&
    typeof b['nonce'] === 'string' &&
    typeof b['payTo'] === 'string' &&
    typeof b['amount'] === 'string' &&
    typeof b['signature'] === 'string' &&
    typeof b['network'] === 'string' &&
    typeof b['issuedAt'] === 'number' &&
    typeof b['expiresAt'] === 'number'
  );
}

/**
 * Verify an `X-PAYMENT-RECEIPT` header value against a device policy.
 *
 * @param header the raw `<body>.<sig>` wire string, or null/undefined if absent
 */
export function verifyPaymentReceipt(
  header: string | null | undefined,
  policy: VerifyPolicy,
): VerifyResult {
  const now = policy.now ?? (() => Math.floor(Date.now() / 1000));
  const skew = policy.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;

  if (typeof header !== 'string' || header.trim().length === 0) {
    return fail('missing_header');
  }

  const split = decodeReceipt(header.trim());
  if (!split) return fail('malformed_header');

  // Authenticate the bytes before reading anything inside them.
  const body = verifyReceipt(split, policy.facilitatorPubkey);
  if (!body) return fail('bad_signature');
  if (!isReceiptBody(body)) return fail('malformed_header');

  // Non-destructive nonce classification; the burn happens at the very end.
  const nonceState = policy.nonces.check(body.nonce);
  if (nonceState === 'unknown') return fail('nonce_unknown');
  if (nonceState === 'replayed') return fail('nonce_replayed');
  if (nonceState === 'expired') return fail('nonce_expired');

  if (body.payTo !== policy.payTo) return fail('wrong_recipient');
  if (body.network !== policy.network) return fail('wrong_network');

  let paid: bigint;
  let required: bigint;
  try {
    paid = BigInt(body.amount);
    required = BigInt(policy.priceMicroUsdc);
  } catch {
    return fail('malformed_header');
  }
  if (paid < required) return fail('insufficient_amount');

  if (body.expiresAt + skew < now()) return fail('receipt_expired');

  const burned = policy.nonces.burn(body.nonce);
  if (burned !== 'valid') {
    // Lost a race with a concurrent request carrying the same nonce.
    return fail('nonce_replayed');
  }

  return { ok: true, receipt: body };
}

/** One-line explanation for a rejection, for logs and the 402 body. */
export function explainFailure(reason: VerifyFailure): string {
  switch (reason) {
    case 'missing_header':
      return 'no X-PAYMENT-RECEIPT header supplied';
    case 'malformed_header':
      return 'receipt is not a well-formed <body>.<sig> pair';
    case 'bad_signature':
      return 'receipt signature does not match the facilitator key';
    case 'nonce_unknown':
      return 'nonce was not issued by this device';
    case 'nonce_replayed':
      return 'nonce was already spent';
    case 'nonce_expired':
      return 'nonce expired before the receipt arrived';
    case 'wrong_recipient':
      return 'payment was made to a different wallet';
    case 'insufficient_amount':
      return 'payment is below the quoted price';
    case 'wrong_network':
      return 'payment settled on the wrong network';
    case 'receipt_expired':
      return 'receipt is older than the accepted skew window';
  }
}
