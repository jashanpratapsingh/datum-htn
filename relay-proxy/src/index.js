/**
 * VENDX relay-proxy — device simulator + facilitator.
 *
 * Simulator: acts as the ESP32 vendor device. Issues 402 challenges,
 * verifies signed receipts, and returns telemetry on success.
 *
 * Facilitator: receives payment notifications, signs receipts. In a
 * production deployment, this endpoint calls Solana RPC to confirm the
 * transfer before signing. Here it trusts the buyer's word (demo only).
 *
 * The ESP32 device holds FACILITATOR_PUBKEY compiled into firmware.
 * Everything else is stateless — nonces are the only server-side state.
 */

import { createServer } from 'node:http';
import nacl from 'tweetnacl';
import {
  buildChallenge,
  signReceipt,
  verifyReceipt,
  encodeReceipt,
  decodeReceipt,
  encodeSettleHeader,
} from '@vendx/protocol';

/** Vendor wallet owner (base58). The ATA is derived by the buyer. */
export const VENDOR_WALLET = 'FHcgXc3YzNnq8WKcH8GaDvbKhJ4ycKxHnR7jzA8zAHU';

/** Price per telemetry fetch: $0.0001 USDC. */
export const VENDOR_PRICE_USD = 0.0001;

/** Generate a fresh Ed25519 keypair for the facilitator. */
export function generateFacilitatorKey() {
  return nacl.sign.keyPair();
}

/**
 * Start the combined device-simulator + facilitator HTTP server.
 *
 * @param {object} opts
 * @param {Uint8Array} opts.facilitatorSecretKey  64-byte Ed25519 secret key
 * @param {Uint8Array} opts.facilitatorPublicKey  32-byte Ed25519 public key
 * @param {number}     [opts.port=3402]
 * @returns {import('node:http').Server}
 */
export function createSimulator({ facilitatorSecretKey, facilitatorPublicKey, port = 3402 }) {
  // In-memory nonce store: nonce → { expiresAt: number, used: boolean }
  // Production: replace with Supabase vendx_nonces table.
  const nonces = new Map();

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/api/telemetry') {
      return handleTelemetry(req, res, { nonces, facilitatorPublicKey, port });
    }

    if (req.method === 'POST' && url.pathname === '/settle') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => handleSettle(res, body, { facilitatorSecretKey }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(port);
  return server;
}

function handleTelemetry(req, res, { nonces, facilitatorPublicKey }) {
  const receiptHeader = req.headers['x-payment-receipt'];

  if (!receiptHeader) {
    // Issue the 402 challenge and mint a nonce.
    const challenge = buildChallenge({
      resource: '/api/telemetry',
      description: 'foot traffic, 5-minute bucket',
      priceUsd: VENDOR_PRICE_USD,
      payTo: VENDOR_WALLET,
    });
    nonces.set(challenge.nonce, { expiresAt: challenge.expiresAt, used: false });
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(challenge));
    return;
  }

  // Verify the receipt the buyer attached.
  const parsed = decodeReceipt(receiptHeader.trim());
  if (!parsed) {
    return json402(res, 'malformed_header');
  }

  const body = verifyReceipt(parsed, facilitatorPublicKey);
  if (!body) {
    return json402(res, 'bad_signature');
  }

  const now = Math.floor(Date.now() / 1000);
  const nonceState = nonces.get(body.nonce);

  if (!nonceState)       return json402(res, 'nonce_unknown');
  if (nonceState.used)   return json402(res, 'nonce_replayed');
  if (body.expiresAt < now) return json402(res, 'receipt_expired');
  if (body.payTo !== VENDOR_WALLET) return json402(res, 'wrong_recipient');
  if (BigInt(body.amount) < BigInt(Math.round(VENDOR_PRICE_USD * 1e6))) {
    return json402(res, 'insufficient_amount');
  }

  // Burn the nonce — single use.
  nonces.set(body.nonce, { ...nonceState, used: true });

  const telemetry = {
    deviceId: 'esp32-sim-001',
    timestamp: now,
    footTraffic: Math.floor(Math.random() * 100),
    temperature: +(22.5 + (Math.random() - 0.5) * 2).toFixed(2),
    bucket: '5min',
    _sim: true,
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(telemetry));
}

function handleSettle(res, rawBody, { facilitatorSecretKey }) {
  let reqBody;
  try {
    reqBody = JSON.parse(rawBody);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad_json' }));
    return;
  }

  const { nonce, txSignature, payTo, amount, network } = reqBody;
  if (!nonce || !txSignature) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing_fields' }));
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const receiptBody = {
    v: 1,
    nonce,
    payTo: payTo ?? VENDOR_WALLET,
    amount: amount ?? String(Math.round(VENDOR_PRICE_USD * 1e6)),
    signature: txSignature,
    network: network ?? 'solana-devnet',
    issuedAt: now,
    expiresAt: now + 300,
  };

  const signed = signReceipt(receiptBody, facilitatorSecretKey);
  const settleResp = {
    success: true,
    transaction: txSignature,
    network: receiptBody.network,
    payer: 'simulator',
    errorReason: null,
  };

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'X-Payment-Response': encodeSettleHeader(settleResp),
  });
  res.end(JSON.stringify({ receipt: encodeReceipt(signed) }));
}

function json402(res, reason) {
  res.writeHead(402, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: reason }));
}
