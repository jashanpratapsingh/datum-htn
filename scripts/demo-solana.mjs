/**
 * The real-settlement demo: sensing node + verifying facilitator + paying agent.
 *
 * Distinct from `demo.mjs`, which drives the simulator relay on port 3402. This
 * one runs the spine that reads an actual radio and moves actual devnet USDC, on
 * ports 4021/4022, so both demos can run side by side.
 *
 * Deliberately a plain orchestrator with no test framework and no cleverness — it
 * runs in front of judges, so its failure modes need to be obvious.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const root = process.cwd();
const env = {
  ...process.env,
  VENDX_ROOT: root,
  VENDX_SETTLEMENT: process.env.VENDX_SETTLEMENT ?? 'mock',
};

const children = [];

function start(name, script) {
  const child = spawn(process.execPath, [script], {
    env,
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (d) => process.stdout.write(String(d)));
  child.stderr.on('data', (d) => process.stderr.write(`${name} ! ${String(d)}`));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`${name} exited with ${code}`);
  });
  return child;
}

async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  return false;
}

function shutdown() {
  for (const c of children) if (!c.killed) c.kill();
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(130);
});

const nodePort = env.VENDX_NODE_PORT ?? '4021';
const facPort = env.VENDX_FACILITATOR_PORT ?? '4022';

const line = '='.repeat(76);
console.log(line);
console.log('VENDX  —  a sensor that sells its own data to an AI over Solana');
console.log(
  `settlement: ${env.VENDX_SETTLEMENT}${
    env.VENDX_SETTLEMENT === 'mock'
      ? '  (nothing verified on-chain; use VENDX_SETTLEMENT=devnet for real USDC)'
      : '  (real devnet USDC, memo-bound, delegate-funded)'
  }`,
);
console.log(line);
console.log();

start('facilitator', 'relay-proxy/dist/facilitator-server.js');
start('node', 'relay-proxy/dist/node.js');

const facUp = await waitFor(`http://127.0.0.1:${facPort}/health`);
const nodeUp = await waitFor(`http://127.0.0.1:${nodePort}/health`);
if (!facUp || !nodeUp) {
  console.error(`\nservices failed to start (facilitator=${facUp} node=${nodeUp})`);
  shutdown();
  process.exit(1);
}

// Let the radio establish a baseline before the first quote, so the price
// reflects a settled sensor rather than a cold one.
const warmupMs = Number(env.VENDX_WARMUP_MS ?? 12_000);
console.log(
  `\nletting the sensor settle for ${(warmupMs / 1000).toFixed(0)}s — walk around now if you like\n`,
);
await sleep(warmupMs);

const before = await fetch(`http://127.0.0.1:${nodePort}/api/stats`).then((r) => r.json());
console.log(`sensor tier : ${before.sensor.provenance}  (${before.sensor.note})`);
console.log(
  `motion      : ${before.sensor.motionLevel}  energy ${before.sensor.motionEnergy.toFixed(4)}  APs ${before.sensor.bssidCount}`,
);
console.log(
  `footfall    : ${before.sensor.footfallToday} today, ${before.sensor.rejectedImpulses} impulses rejected`,
);
console.log(`price       : $${before.price.usd.toFixed(6)}`);
console.log(`              ${before.price.rationale}`);
console.log();

await new Promise((resolve) => {
  const buyer = start('buyer', 'agent-buyer/dist/buy-node.js');
  buyer.on('exit', resolve);
});

const after = await fetch(`http://127.0.0.1:${nodePort}/api/stats`).then((r) => r.json());
console.log();
console.log('-'.repeat(76));
console.log(
  `books : earned $${after.books.earnedUsd.toFixed(6)}   operating costs $${after.books.spentUsd.toFixed(6)}   net $${after.books.netUsd.toFixed(6)}`,
);
console.log(
  `sales : ${after.books.sales}    served ${after.served}    refused ${after.refused}    insolvent ${after.books.insolvent}`,
);
console.log(`price now: $${after.price.usd.toFixed(6)}`);
console.log(`           ${after.price.rationale}`);
console.log('-'.repeat(76));

shutdown();
await sleep(200);
process.exit(0);
