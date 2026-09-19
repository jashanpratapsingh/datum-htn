/**
 * VENDX agent-buyer.
 *
 * The AI scraper: makes a data request, handles a 402 challenge,
 * enforces its spend policy, obtains a receipt from the facilitator,
 * and replays the request with the receipt to collect real data.
 *
 * No Solana RPC calls in simulator mode — txSignature is a synthetic
 * string that the facilitator accepts (see relay-proxy/src/index.js).
 * In production, step 3 would call sendAndConfirmTransaction before
 * posting to /settle.
 */

import {
  selectRequirements,
  USDC_MINT_DEVNET,
} from '@vendx/protocol';

/**
 * Buy one telemetry reading from a VENDX vendor.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl               Vendor base URL, e.g. http://localhost:3402
 * @param {bigint} [opts.spendLimitMicroUsdc] Max spend per call (default 10 000 000 = $10)
 * @returns {Promise<{telemetry: object, paid: boolean, receipt?: string}>}
 */
export async function buy({ baseUrl, spendLimitMicroUsdc = 10_000_000n }) {
  const resourceUrl = `${baseUrl}/api/telemetry`;

  // 1. Initial request — expect 402.
  const res1 = await fetch(resourceUrl);

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

  // 4. Simulate Solana payment. In production: sendAndConfirmTransaction().
  //    The simulator accepts any non-empty string as a tx signature.
  const fakeTxSig = 'SimTx1111' + challenge.nonce.slice(0, 48);
  console.log(`  → execute  txSig=${fakeTxSig.slice(0, 16)}… (simulator)`);

  // 5. Notify the facilitator and receive a signed receipt.
  const settleRes = await fetch(`${baseUrl}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nonce: challenge.nonce,
      txSignature: fakeTxSig,
      payTo: req.payTo,
      amount: req.maxAmountRequired,
      network: req.network,
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

  return { telemetry, paid: true, receipt };
}
