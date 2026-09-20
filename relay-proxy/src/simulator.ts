/**
 * ESP32 device simulator.
 *
 * Builds 402 challenges and verifies facilitator-signed receipts exactly
 * as real firmware would — same codec, same key, same field checks.
 * No hardware required; the demo runs entirely against this module.
 *
 * Nonces live in the Store (memory or Supabase), so a receipt redeemed before
 * a restart stays redeemed after it.
 */

import {
  buildChallenge,
  verifyReceipt,
  decodeReceipt,
  type PaymentRequiredBody,
  type ReceiptBody,
} from '@vendx/protocol';
import { getKeys } from './keys.js';
import type { Store } from './store/types.js';

/**
 * The vendor's Solana wallet (owner, not the ATA). Set VENDX_VENDOR_WALLET to a
 * key you control — scripts/relay.sh derives it from ~/.vendx/vendor-devnet.json.
 * The fallback is a placeholder nobody holds; payments to it are lost.
 */
export const VENDOR_WALLET =
  process.env.VENDX_VENDOR_WALLET ?? 'FHcgXc3YzNnq8WKcH8GaDvbKhJ4ycKxHnR7jzA8zAHU';
export const VENDOR_PRICE_USD = 0.0001;
const NETWORK = 'solana-devnet' as const;

export async function buildDeviceChallenge(store: Store, deviceId: string): Promise<PaymentRequiredBody> {
  const challenge = buildChallenge({
    resource: '/api/telemetry',
    description: 'foot traffic, 5-minute bucket',
    priceUsd: VENDOR_PRICE_USD,
    payTo: VENDOR_WALLET,
    network: NETWORK,
    ttlSeconds: 300,
  });

  // Awaited on purpose: a nonce we failed to persist must not be issued.
  await store.issueNonce(challenge.nonce, {
    expiresAt: challenge.expiresAt,
    used: false,
    payTo: VENDOR_WALLET,
    amountMicroUsdc: challenge.accepts[0].maxAmountRequired,
    deviceId,
    network: NETWORK,
  });

  return challenge;
}

export type DeviceVerifyResult =
  | { ok: true; body: ReceiptBody }
  | { ok: false; reason: string };

export async function verifyDeviceReceipt(receiptHeader: string, store: Store): Promise<DeviceVerifyResult> {
  const { publicKey } = getKeys();

  const signed = decodeReceipt(receiptHeader.trim());
  if (!signed) return { ok: false, reason: 'malformed_header' };

  const body = verifyReceipt(signed, publicKey);
  if (!body) return { ok: false, reason: 'bad_signature' };

  const now = Math.floor(Date.now() / 1000);
  if (body.expiresAt < now) return { ok: false, reason: 'receipt_expired' };
  if (body.payTo !== VENDOR_WALLET) return { ok: false, reason: 'wrong_recipient' };
  if (body.network !== NETWORK) return { ok: false, reason: 'wrong_network' };
  if (BigInt(body.amount) < BigInt(Math.round(VENDOR_PRICE_USD * 1e6))) {
    return { ok: false, reason: 'insufficient_amount' };
  }

  // Burn nonce — single use, enforced here even though the facilitator already
  // recorded the settlement, as defence-in-depth against a receipt being replayed.
  const consumed = await store.consumeNonce(body.nonce);
  if (!consumed.ok) return { ok: false, reason: consumed.reason };

  return { ok: true, body };
}

export function makeTelemetry() {
  return {
    deviceId: 'esp32-sim-001',
    timestamp: Math.floor(Date.now() / 1000),
    footTraffic: Math.floor(Math.random() * 100),
    temperature: +(22.5 + (Math.random() - 0.5) * 2).toFixed(2),
    bucket: '5min',
    _sim: true,
  };
}
