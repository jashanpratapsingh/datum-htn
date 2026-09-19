/**
 * VENDX agent-buyer entry point.
 *
 * Orchestrates the full 402 → pay → receipt → 200 arc:
 *   1. GET /api/telemetry  → 402 challenge
 *   2. selectRequirements  → find a payable offer within daily budget
 *   3. mockSolanaTxSig     → simulate USDC transfer (demo only)
 *   4. POST /settle        → facilitator signs a receipt
 *   5. GET /api/telemetry  → 200 telemetry with receipt attached
 */

import {
  selectRequirements,
  decodeReceipt,
  microUsdcToUsd,
  USDC_MINT_DEVNET,
  type PaymentRequiredBody,
} from '@vendx/protocol';
import { SpendPolicy } from './policy.js';
import { getWallet, mockSolanaTxSig } from './wallet.js';

const RELAY_URL = process.env.RELAY_URL ?? 'http://localhost:3402';
const NETWORK = 'solana-devnet' as const;

async function fetchTelemetry(receipt?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (receipt) headers['x-payment-receipt'] = receipt;
  return fetch(`${RELAY_URL}/api/telemetry`, { headers });
}

async function postSettle(
  nonce: string,
  txSignature: string,
  payTo: string,
  amount: string,
  network: string,
): Promise<string> {
  const res = await fetch(`${RELAY_URL}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce, txSignature, payTo, amount, network }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { errorReason?: string };
    throw new Error(`settle ${res.status}: ${err.errorReason ?? 'unknown'}`);
  }
  const data = (await res.json()) as { receipt: string };
  return data.receipt;
}

export async function runBuyerOnce(): Promise<void> {
  const policy = new SpendPolicy();
  const wallet = getWallet();

  console.log(`[agent-buyer] wallet: ${wallet.address.slice(0, 16)}…`);
  console.log(
    `[agent-buyer] daily budget remaining: $${microUsdcToUsd(policy.remainingToday.toString()).toFixed(4)}`,
  );

  // Step 1: initial request — expect 402
  console.log(`\n[agent-buyer] → GET ${RELAY_URL}/api/telemetry`);
  const res1 = await fetchTelemetry();

  if (res1.status !== 402) {
    const data = await res1.json();
    console.log(`[agent-buyer] unexpected status ${res1.status}:`, data);
    return;
  }

  const challenge = (await res1.json()) as PaymentRequiredBody;
  console.log(`[agent-buyer] ← 402  nonce=${challenge.nonce.slice(0, 8)}…`);

  // Step 2: find an offer within policy
  const req = selectRequirements(challenge, {
    network: NETWORK,
    asset: USDC_MINT_DEVNET,
    maxMicroUsdc: policy.remainingToday,
  });

  if (!req) {
    console.error('[agent-buyer] no acceptable offer (budget exhausted or network mismatch)');
    return;
  }

  const amount = BigInt(req.maxAmountRequired);
  console.log(
    `[agent-buyer] ✓ policy  amount=${req.maxAmountRequired} µUSDC  to=${req.payTo.slice(0, 8)}…`,
  );

  if (!policy.canSpend(amount)) {
    console.error('[agent-buyer] daily cap would be exceeded — aborting');
    return;
  }

  // Step 3: simulate Solana transfer
  const txSig = mockSolanaTxSig();
  console.log(`[agent-buyer] → execute  txSig=${txSig.slice(0, 16)}… (simulator)`);

  // Step 4: settle and receive signed receipt
  console.log(`[agent-buyer] → POST ${RELAY_URL}/settle`);
  const receipt = await postSettle(challenge.nonce, txSig, req.payTo, req.maxAmountRequired, req.network);

  const decoded = decodeReceipt(receipt);
  if (!decoded) throw new Error('facilitator returned malformed receipt');

  console.log(`[agent-buyer] ← receipt  ${receipt.slice(0, 24)}…`);

  // Record spend before re-requesting (so a crash between settle and re-request
  // doesn't let us use a paid receipt against our own cap).
  policy.recordSpend(amount);

  // Step 5: replay with receipt attached
  console.log(`[agent-buyer] → GET ${RELAY_URL}/api/telemetry  (with receipt)`);
  const res2 = await fetchTelemetry(receipt);

  if (!res2.ok) {
    const err = await res2.json().catch(() => ({}));
    console.error('[agent-buyer] device rejected receipt:', err);
    return;
  }

  const telemetry = await res2.json();
  console.log('\n[agent-buyer] ← 200 OK — telemetry:');
  console.log(JSON.stringify(telemetry, null, 2));
}

// Allow direct execution: node dist/index.js
runBuyerOnce().catch((err: unknown) => {
  console.error('[agent-buyer] fatal:', err);
  process.exit(1);
});
