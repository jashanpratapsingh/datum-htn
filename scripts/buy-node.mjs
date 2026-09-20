#!/usr/bin/env node
/**
 * Buy one reading from a VENDX node (an ESP32 running firmware-vendor/) with a
 * REAL devnet USDC payment, settled by the relay the node registered with.
 *
 *   export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
 *   node scripts/buy-node.mjs http://vendx-esp32c3-6e94.local          # node on the LAN (mDNS)
 *   node scripts/buy-node.mjs http://192.168.4.1                       # laptop joined to the node's AP
 *   node scripts/buy-node.mjs http://192.168.4.1 --relay http://192.168.4.2:3402
 *   VENDX_FAKE_PAYMENT=1 node scripts/buy-node.mjs http://...          # no payment; needs scripts/relay.sh demo
 *
 * The arc is the one docs/PROTOCOL.md describes, with the device side on real
 * hardware: 402 from the node → USDC transferChecked with the nonce as memo →
 * relay /settle verifies the transaction on-chain against the node's
 * REGISTERED wallet and price → relay-signed receipt → node verifies the
 * Ed25519 signature offline → 200 with `source: "esp32c3"`.
 *
 * Which relay: the node names its facilitator in the challenge
 * (`accepts[0].extra.facilitator`, the URL it registered with). `--relay`
 * overrides that. The relay must be the one whose public key is compiled into
 * the node (scripts/gen-facilitator-key.mjs), and the node must be registered
 * with it (`relay <url>` over the node's serial console) or /settle answers
 * 402 nonce_unknown — the relay cannot account for a nonce it never saw.
 *
 * Buyer wallet: agent-buyer/src/wallet.ts (~/.config/solana/id.json or
 * VENDX_BUYER_KEYPAIR). It must hold SOL for fees and Circle devnet USDC.
 */
import { buy } from '../agent-buyer/src/buyer.js';

const argv = process.argv.slice(2);
const baseUrl = argv.find((a) => !a.startsWith('--'));
const relayIdx = argv.indexOf('--relay');
const facilitatorUrl = relayIdx >= 0 ? argv[relayIdx + 1] : undefined;
if (!baseUrl) {
  console.error('usage: node scripts/buy-node.mjs <node-base-url> [--relay <relay-base-url>]');
  process.exit(2);
}

const started = Date.now();
console.log(`\n─── Buying one reading from ${baseUrl} ───────────────────\n`);
try {
  const health = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json())
    .catch((e) => ({ error: e.message }));
  console.log(`  node /health: ${JSON.stringify(health)}`);
  if (health.source !== 'esp32c3') console.log('  ! this is not a VENDX node (source != esp32c3)');
  if (health.registered === false) console.log('  ! node reports it is NOT registered with a relay; /settle will refuse its nonce');

  const result = await buy({ baseUrl: baseUrl.replace(/\/+$/, ''), facilitatorUrl, spendLimitMicroUsdc: 1_000_000n });

  console.log('\n─── Telemetry ───────────────────────────────────────────\n');
  console.log(JSON.stringify(result.telemetry, null, 2));
  console.log(`\n  source      : ${result.telemetry.source}`);
  console.log(`  payment     : ${result.payment}${result.explorer ? `  ${result.explorer}` : '  (no transaction was made)'}`);
  console.log(`  facilitator : ${result.facilitator}`);
  console.log(`  elapsed     : ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  process.exit(result.telemetry.source === 'esp32c3' ? 0 : 1);
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
}
