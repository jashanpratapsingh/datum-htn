#!/usr/bin/env node
/**
 * VENDX end-to-end demo.
 *
 * Runs entirely on localhost — no ESP32, no Solana RPC.
 * relay-proxy starts a combined device-simulator + facilitator.
 * agent-buyer runs the full 402 → pay → receipt → 200 arc.
 *
 * Source: simulator — all telemetry is synthetic (_sim: true).
 */

import { createRelayServer } from '../relay-proxy/dist/server.js';
import { buy } from '../agent-buyer/src/buyer.js';

const PORT = 3402;

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         VENDX  —  ESP32 x402 Payment Demo           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log('Mode: simulator (relay-proxy in-process, no hardware)\n');

  // The relay-proxy generates/loads a facilitator keypair from keys/ on first
  // run. Buyer replays with the facilitator-signed receipt — same arc as
  // production, no external keys passed in.
  const server = createRelayServer(PORT);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, resolve);
  });

  console.log(`Relay server       : http://localhost:${PORT}`);

  try {
    console.log('\n─── AI Scraper requesting telemetry ───────────────────\n');

    const result = await buy({
      baseUrl: `http://localhost:${PORT}`,
      spendLimitMicroUsdc: 1_000_000n, // $1.00 limit
    });

    console.log('\n─── Telemetry received ────────────────────────────────\n');
    console.log(JSON.stringify(result.telemetry, null, 2));
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  ✓  402 → pay → receipt → 200  arc complete (SIM)   ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    process.exit(0);
  } catch (err) {
    console.error('\n✗ Demo failed:', err.message);
    process.exit(1);
  } finally {
    server.close();
  }
}

main();
