/**
 * VENDX agent-buyer CLI.
 *
 *   RELAY_URL=https://relay.vendx.biz VENDX_API_KEY=vendx_sk_… node dist/index.js
 *
 * Runs one purchase (see buy.ts): 402 → policy → real USDC transfer → /settle
 * → 200 telemetry. The API key is optional; with it, the purchase shows up
 * under your account on the website.
 */

import { BuyError, buyReading } from './buy.js';
import { BUYER_KEYPAIR_PATH, fundingHints } from './wallet.js';

const RELAY_URL = process.env.RELAY_URL ?? 'http://localhost:3402';

export async function runBuyerOnce(): Promise<void> {
  console.log(`[agent-buyer] keypair: ${BUYER_KEYPAIR_PATH}`);
  try {
    const result = await buyReading({
      relayUrl: RELAY_URL,
      apiKey: process.env.VENDX_API_KEY,
      log: (l) => console.log(l),
    });
    console.log('\n[agent-buyer] ← 200 OK — telemetry:');
    console.log(JSON.stringify(result.telemetry, null, 2));
    console.log(`\n[agent-buyer] paid ${result.amountMicroUsdc} µUSDC (${result.payment}) — ${result.solscanUrl}`);
  } catch (e) {
    if (e instanceof BuyError) {
      console.error(`[agent-buyer] ${e.code}: ${e.message}`);
      if (e.detail) console.error(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail));
      if (e.code === 'buyer_unfunded') console.error(fundingHints());
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

// Allow direct execution: node dist/index.js
runBuyerOnce().catch((err: unknown) => {
  console.error('[agent-buyer] fatal:', err);
  process.exit(1);
});
