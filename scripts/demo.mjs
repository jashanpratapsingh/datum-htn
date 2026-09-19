#!/usr/bin/env node
/**
 * VENDX end-to-end demo.
 *
 * Runs entirely on localhost — no ESP32, no Solana RPC. The relay-proxy
 * starts a combined device-simulator + facilitator; the agent-buyer runs
 * the full 402 → pay → receipt → 200 arc.
 *
 * Output comes from simulator (src: _sim: true) — not from hardware.
 */

import { generateFacilitatorKey, createSimulator, VENDOR_WALLET } from '../relay-proxy/src/index.js';
import { buy } from '../agent-buyer/src/buyer.js';

const PORT = 3402;

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         VENDX  —  ESP32 x402 Payment Demo           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log('Mode: simulator (relay-proxy in-process, no hardware)\n');

  // Generate a fresh facilitator keypair. Production: load from env / KMS.
  const facilitatorKey = generateFacilitatorKey();
  console.log(`Facilitator pubkey : ${Buffer.from(facilitatorKey.publicKey).toString('hex').slice(0, 32)}…`);
  console.log(`Vendor wallet      : ${VENDOR_WALLET.slice(0, 12)}…`);
  console.log(`Port               : ${PORT}\n`);

  // Start the combined simulator + facilitator server.
  const server = createSimulator({
    facilitatorSecretKey: facilitatorKey.secretKey,
    facilitatorPublicKey: facilitatorKey.publicKey,
    port: PORT,
  });

  // Give the server a tick to bind before making requests.
  await new Promise(r => setTimeout(r, 50));

  try {
    console.log('─── AI Scraper requesting telemetry ───────────────────\n');

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
