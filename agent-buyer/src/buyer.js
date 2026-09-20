/**
 * VENDX agent-buyer.
 *
 * The AI scraper: makes a data request, handles a 402 challenge,
 * enforces its spend policy, obtains a receipt from the facilitator,
 * and replays the request with the receipt to collect real data.
 *
 * Step 4 is a real USDC transferChecked on Solana (see ../dist/wallet.js,
 * built from src/wallet.ts — run `npm run build -w @vendx/agent-buyer`).
 * VENDX_FAKE_PAYMENT=1 substitutes a fabricated signature, which only a relay
 * started with VENDX_SETTLEMENT=trust will accept; the result then says
 * `payment: "fake"` so nobody mistakes it for a settlement.
 */

import {
  selectRequirements,
  USDC_MINT_DEVNET,
} from '@vendx/protocol';
import { FAKE_PAYMENT, mockSolanaTxSig, payUsdc } from '../dist/wallet.js';

/**
 * Buy one telemetry reading from a VENDX vendor.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl               Vendor base URL, e.g. http://localhost:3402 (the relay's
 *                                            simulator) or http://vendx-esp32c3-6e94.local (a node)
 * @param {string} [opts.facilitatorUrl]      Where to POST /settle. Default: the URL the vendor names
 *                                            in its challenge (`extra.facilitator`), else `baseUrl`.
 *                                            A node cannot settle for itself; the relay does it.
 * @param {bigint} [opts.spendLimitMicroUsdc] Max spend per call (default 10 000 000 = $10)
 * @returns {Promise<{telemetry: object, paid: boolean, receipt?: string, txSignature?: string, payment?: 'solana'|'fake', explorer?: string, facilitator?: string}>}
 */
export async function buy({ baseUrl, facilitatorUrl, spendLimitMicroUsdc = 10_000_000n }) {
  const resourceUrl = `${baseUrl}/api/telemetry`;
  // Optional attribution: an API key minted on the website ties this purchase to an account.
  const keyHeaders = process.env.VENDX_API_KEY ? { 'X-Vendx-Agent-Key': process.env.VENDX_API_KEY } : {};

  // 1. Initial request — expect 402.
  const res1 = await fetch(resourceUrl, { headers: keyHeaders });

  if (res1.status !== 402) {
    if (res1.ok) return { telemetry: await res1.json(), paid: false };
    throw new Error(`Unexpected status ${res1.status} on first request`);
  }

  // 2. Parse 402 challenge body.
  const challenge = await res1.json();
  console.log(`  ← 402  nonce=${challenge.nonce.slice(0, 8)}…  expires=${challenge.expiresAt}`);

  // 3. Enforce spend policy — selectRequirements returns null if over budget.
  const req = selectRequirements(challenge, {
    network: 'solana-devnet',
    asset: USDC_MINT_DEVNET,
    maxMicroUsdc: spendLimitMicroUsdc,
  });

  if (!req) {
    throw new Error(
      `No acceptable offer: limit=${spendLimitMicroUsdc} µUSDC, ` +
      `offered=${challenge.accepts?.map(a => a.maxAmountRequired).join(',')}`,
    );
  }

  console.log(`  ✓ policy  amount=${req.maxAmountRequired} µUSDC  to=${req.payTo.slice(0, 8)}…`);

  // A self-serving node tells us who it is and who settles for it. The relay
  // needs the device id to account for a nonce it did not mint itself.
  const extra = req.extra && typeof req.extra === 'object' ? req.extra : {};
  const deviceId = typeof extra.deviceId === 'string' ? extra.deviceId : undefined;
  const facilitator = (facilitatorUrl ?? (typeof extra.facilitator === 'string' ? extra.facilitator : baseUrl)).replace(/\/+$/, '');
  if (facilitator !== baseUrl) console.log(`  ✓ vendor  ${deviceId ?? '?'} (${extra.source ?? 'unknown source'}), settles at ${facilitator}`);

  // 4. Pay: a real, confirmed USDC transfer with the nonce in a memo.
  let txSig;
  let payment;
  let explorer;
  if (FAKE_PAYMENT) {
    txSig = mockSolanaTxSig();
    payment = 'fake';
    console.log(`  → execute  txSig=${txSig.slice(0, 16)}… (FAKE — no payment happened)`);
  } else {
    console.log(`  → transfer ${req.maxAmountRequired} µUSDC → ${req.payTo.slice(0, 8)}… on ${req.network}`);
    const paid = await payUsdc({
      payTo: req.payTo,
      amountMicroUsdc: req.maxAmountRequired,
      network: req.network,
      nonce: challenge.nonce,
    });
    txSig = paid.signature;
    payment = 'solana';
    explorer = paid.explorer;
    console.log(`  ✓ confirmed ${explorer}`);
  }

  // 5. Notify the facilitator and receive a signed receipt.
  const settleRes = await fetch(`${facilitator}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keyHeaders },
    body: JSON.stringify({
      nonce: challenge.nonce,
      txSignature: txSig,
      payTo: req.payTo,
      amount: req.maxAmountRequired,
      network: req.network,
      ...(deviceId ? { deviceId } : {}),
    }),
  });

  if (!settleRes.ok) {
    const text = await settleRes.text();
    throw new Error(`Settle failed ${settleRes.status}: ${text}`);
  }

  const { receipt } = await settleRes.json();
  console.log(`  ← receipt  ${receipt.slice(0, 24)}…`);

  // 6. Replay the original request with the facilitator-signed receipt.
  const res2 = await fetch(resourceUrl, {
    headers: { 'X-Payment-Receipt': receipt },
  });

  if (!res2.ok) {
    const errBody = await res2.json().catch(() => ({}));
    throw new Error(`Vendor rejected receipt: ${errBody.error ?? res2.status}`);
  }

  const telemetry = await res2.json();
  console.log(`  ← 200 OK`);

  return { telemetry, paid: true, receipt, txSignature: txSig, payment, explorer, facilitator };
}
