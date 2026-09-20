/**
 * Integration tests for relay-proxy HTTP endpoints.
 *
 * Spins up a real createRelayServer on a random port, exercises every
 * endpoint, and tears the server down afterwards.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createRelayServer } from './server.js';
import { VENDOR_WALLET } from './simulator.js';
import { _resetNodes } from './node-registry.js';
import { signReceipt, encodeReceipt } from '@vendx/protocol';
import nacl from 'tweetnacl';

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

const server = createRelayServer(0);
await new Promise<void>(resolve => server.listen(0, resolve));
const { port } = server.address() as AddressInfo;
const BASE = `http://localhost:${port}`;

after(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve())),
    ),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function get(path: string, headers?: Record<string, string>) {
  return fetch(`${BASE}${path}`, { headers });
}

async function post(path: string, body: string, contentType = 'application/json') {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
}

/** Run a full GET → POST /settle → GET cycle, return { nonce, receipt }. */
async function runFullFlow(): Promise<{ nonce: string; receipt: string }> {
  // Step 1: hit /api/telemetry without auth → 402
  const r1 = await get('/api/telemetry');
  assert.equal(r1.status, 402);
  const challenge = (await r1.json()) as { nonce: string };
  const { nonce } = challenge;

  // Step 2: settle
  const body = JSON.stringify({
    nonce,
    txSignature: 'SimTx_integration_test',
    payTo: VENDOR_WALLET,
    amount: '100',
    network: 'solana-devnet',
  });
  const r2 = await post('/settle', body);
  assert.equal(r2.status, 200);
  const settled = (await r2.json()) as { receipt: string; success: boolean };
  assert.equal(settled.success, true);

  return { nonce, receipt: settled.receipt };
}

// ---------------------------------------------------------------------------
// Health and routing
// ---------------------------------------------------------------------------

test('GET /health → 200 { status: ok, mode: simulator }', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; mode: string };
  assert.equal(body.status, 'ok');
  assert.equal(body.mode, 'simulator');
});

test('GET /unknown-path-xyz → 404 { error: not_found }', async () => {
  const res = await get('/unknown-path-xyz');
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'not_found');
});

test('OPTIONS /api/telemetry (CORS preflight) → 204 with Access-Control-Allow-Origin: *', async () => {
  const res = await fetch(`${BASE}/api/telemetry`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

// ---------------------------------------------------------------------------
// GET /api/telemetry — 402 path
// ---------------------------------------------------------------------------

test('GET /api/telemetry without receipt → 402 body has x402Version: 1', async () => {
  const res = await get('/api/telemetry');
  assert.equal(res.status, 402);
  const body = (await res.json()) as { x402Version: number };
  assert.equal(body.x402Version, 1);
});

test('GET /api/telemetry without receipt → 402 body accepts is non-empty with scheme: exact', async () => {
  const res = await get('/api/telemetry');
  assert.equal(res.status, 402);
  const body = (await res.json()) as { accepts: Array<{ scheme: string }> };
  assert.ok(Array.isArray(body.accepts));
  assert.ok(body.accepts.length >= 1);
  assert.equal(body.accepts[0].scheme, 'exact');
});

test('GET /api/telemetry without receipt → 402 body has nonce (string) and expiresAt (number)', async () => {
  const res = await get('/api/telemetry');
  assert.equal(res.status, 402);
  const body = (await res.json()) as { nonce: string; expiresAt: number };
  assert.ok(typeof body.nonce === 'string' && body.nonce.length > 0);
  assert.ok(typeof body.expiresAt === 'number');
});

test('GET /api/telemetry with bad receipt (random string) → 402 { error: malformed_header }', async () => {
  const res = await get('/api/telemetry', { 'X-Payment-Receipt': 'this-is-not-a-receipt' });
  assert.equal(res.status, 402);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'malformed_header');
});

test('GET /api/telemetry with bad-signature receipt → 402 { error: bad_signature }', async () => {
  // Get a valid nonce so receipt shape is structurally correct
  const r1 = await get('/api/telemetry');
  const challenge = (await r1.json()) as { nonce: string; expiresAt: number };

  // Sign with a fresh random keypair — the server won't accept it
  const wrongKp = nacl.sign.keyPair();
  const fakeBody = {
    v: 1 as const,
    nonce: challenge.nonce,
    payTo: VENDOR_WALLET,
    amount: '100',
    signature: 'fakeTxSig',
    network: 'solana-devnet' as const,
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 300,
  };
  const fakeReceipt = encodeReceipt(signReceipt(fakeBody, wrongKp.secretKey));

  const res = await get('/api/telemetry', { 'X-Payment-Receipt': fakeReceipt });
  assert.equal(res.status, 402);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'bad_signature');
});

// ---------------------------------------------------------------------------
// Full E2E happy path
// ---------------------------------------------------------------------------

test('Full E2E: GET 402 → POST /settle → GET with receipt → 200 with telemetry', async () => {
  // Step 1
  const r1 = await get('/api/telemetry');
  assert.equal(r1.status, 402);
  const challenge = (await r1.json()) as { nonce: string; x402Version: number };
  const { nonce } = challenge;
  assert.ok(nonce.length > 0);

  // Step 2
  const settleBody = JSON.stringify({
    nonce,
    txSignature: 'SimTx_e2e_happy_path',
    payTo: VENDOR_WALLET,
    amount: '100',
    network: 'solana-devnet',
  });
  const r2 = await post('/settle', settleBody);
  assert.equal(r2.status, 200);
  const settled = (await r2.json()) as { receipt: string; success: boolean };
  assert.equal(settled.success, true);
  assert.ok(typeof settled.receipt === 'string' && settled.receipt.includes('.'));

  // Step 3
  const r3 = await get('/api/telemetry', { 'X-Payment-Receipt': settled.receipt });
  assert.equal(r3.status, 200);
  const telemetry = (await r3.json()) as {
    deviceId: string;
    timestamp: number;
    footTraffic: number;
  };
  assert.ok(typeof telemetry.deviceId === 'string' && telemetry.deviceId.length > 0);
  assert.ok(typeof telemetry.timestamp === 'number');
  assert.ok(typeof telemetry.footTraffic === 'number');
});

// ---------------------------------------------------------------------------
// Replay attack (nonce reuse)
// ---------------------------------------------------------------------------

test('Replay attack: using the same receipt twice → second attempt 402 { error: nonce_replayed }', async () => {
  const { receipt } = await runFullFlow();

  // First use → 200
  const r1 = await get('/api/telemetry', { 'X-Payment-Receipt': receipt });
  assert.equal(r1.status, 200);

  // Second use with same receipt → 402 nonce_replayed
  const r2 = await get('/api/telemetry', { 'X-Payment-Receipt': receipt });
  assert.equal(r2.status, 402);
  const body = (await r2.json()) as { error: string };
  assert.equal(body.error, 'nonce_replayed');
});

// ---------------------------------------------------------------------------
// Unknown nonce
// ---------------------------------------------------------------------------

test('Unknown nonce: /settle refuses to sign for a nonce this relay never issued', async () => {
  // Even in trust mode the facilitator checks the nonce against its own store;
  // no receipt exists for the device to reject.
  const unknownNonce = 'nonce-that-was-never-issued-by-any-challenge';
  const settleBody = JSON.stringify({
    nonce: unknownNonce,
    txSignature: 'SimTx_unknown_nonce',
    payTo: VENDOR_WALLET,
    amount: '100',
    network: 'solana-devnet',
  });
  const r1 = await post('/settle', settleBody);
  assert.equal(r1.status, 402);
  const body = (await r1.json()) as { success: boolean; errorReason: string };
  assert.equal(body.success, false);
  assert.equal(body.errorReason, 'nonce_unknown');
});

test('Signature reuse: the same txSignature cannot settle two different nonces', async () => {
  const r1 = await get('/api/telemetry');
  const { nonce: n1 } = (await r1.json()) as { nonce: string };
  const r2 = await get('/api/telemetry');
  const { nonce: n2 } = (await r2.json()) as { nonce: string };
  const sig = 'SimTx_reused_once';
  const mk = (nonce: string) =>
    JSON.stringify({ nonce, txSignature: sig, payTo: VENDOR_WALLET, amount: '100', network: 'solana-devnet' });
  assert.equal((await post('/settle', mk(n1))).status, 200);
  const dup = await post('/settle', mk(n2));
  assert.equal(dup.status, 402);
  assert.equal(((await dup.json()) as { errorReason: string }).errorReason, 'signature_reused');
});

// ---------------------------------------------------------------------------
// POST /settle error paths
// ---------------------------------------------------------------------------

test("POST /settle with body 'not-json' → 400 { error: bad_json }", async () => {
  const res = await post('/settle', 'not-json', 'text/plain');
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'bad_json');
});

test('POST /settle with {} (missing fields) → 400 with error containing missing_fields', async () => {
  const res = await post('/settle', '{}');
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.includes('missing_fields'));
});

test('POST /settle with { nonce: "x" } (missing txSignature) → 400', async () => {
  const res = await post('/settle', JSON.stringify({ nonce: 'x' }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Fleet endpoints
// ---------------------------------------------------------------------------

test('GET /api/devices → 200, devices array length >= 1 with required fields', async () => {
  const res = await get('/api/devices');
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    devices: Array<{
      id: string;
      source: string;
      priceUsd: number;
      totalSales: number;
      totalEarnedMicroUsdc: string;
    }>;
  };
  assert.ok(Array.isArray(body.devices));
  assert.ok(body.devices.length >= 1);
  const d = body.devices[0];
  assert.ok(typeof d.id === 'string' && d.id.length > 0);
  assert.ok(typeof d.source === 'string');
  assert.ok(typeof d.priceUsd === 'number');
  assert.ok(typeof d.totalSales === 'number');
  assert.ok(typeof d.totalEarnedMicroUsdc === 'string');
});

test('GET /api/devices/:id with valid deviceId → 200 with device and recentSales', async () => {
  // First get the device id
  const listRes = await get('/api/devices');
  const { devices } = (await listRes.json()) as { devices: Array<{ id: string }> };
  const deviceId = devices[0].id;

  const res = await get(`/api/devices/${encodeURIComponent(deviceId)}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { device: unknown; recentSales: unknown[] };
  assert.ok(body.device !== undefined);
  assert.ok(Array.isArray(body.recentSales));
});

test('GET /api/devices/no-such-device-xyz → 404 { error: device_not_found, id }', async () => {
  const res = await get('/api/devices/no-such-device-xyz');
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string; id: string };
  assert.equal(body.error, 'device_not_found');
  assert.equal(body.id, 'no-such-device-xyz');
});

test('GET /api/sales → 200 with sales array', async () => {
  const res = await get('/api/sales');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sales: unknown[] };
  assert.ok(Array.isArray(body.sales));
});

test("GET /api/policy → 200 with correct cap/limit values and today's date", async () => {
  const res = await get('/api/policy');
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    capMicroUsdc: string;
    capUsd: number;
    perRequestLimitMicroUsdc: string;
    date: string;
  };
  assert.equal(body.capMicroUsdc, '5000000');
  assert.equal(body.capUsd, 5.0);
  assert.equal(body.perRequestLimitMicroUsdc, '100');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(body.date, today);
});

test('GET /api/ledger → 200 with programId, network, deployed, entries, compressionNote', async () => {
  const res = await get('/api/ledger');
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    programId: string;
    network: string;
    deployed: boolean;
    entries: unknown[];
    compressionNote: string;
  };
  assert.ok(typeof body.programId === 'string' && body.programId.length > 0);
  assert.equal(body.network, 'solana-devnet');
  assert.equal(body.deployed, false);
  assert.ok(Array.isArray(body.entries));
  assert.ok(typeof body.compressionNote === 'string' && body.compressionNote.length > 0);
});

test('GET /api/screen without VENDX_ALLOW_SCREEN → 404 { error: screen_capture_disabled, hint }', async () => {
  // Ensure the env var is NOT set for this test
  const savedEnv = process.env.VENDX_ALLOW_SCREEN;
  delete process.env.VENDX_ALLOW_SCREEN;

  try {
    const res = await get('/api/screen');
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string; hint: string };
    assert.equal(body.error, 'screen_capture_disabled');
    assert.ok(typeof body.hint === 'string' && body.hint.length > 0);
  } finally {
    if (savedEnv !== undefined) process.env.VENDX_ALLOW_SCREEN = savedEnv;
  }
});

// ---------------------------------------------------------------------------
// Node registration (an ESP32 running firmware-vendor, minting its own nonces)
// ---------------------------------------------------------------------------

const NODE_ID = 'vendx-esp32c3-test';
const NODE_WALLET = '3Tm2aUwZdrhuAY37k8q4oqLgjGkYaejVbCoyCaCCwXdp';
/** What firmware-vendor/src/main.cpp registerWithRelay() posts. The url is unreachable on purpose. */
const registration = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    deviceId: NODE_ID, source: 'esp32c3', chip: 'ESP32-C3', url: 'http://127.0.0.1:9', mdns: `${NODE_ID}.local`,
    resource: '/api/telemetry', payTo: NODE_WALLET, priceMicroUsdc: '10000', network: 'solana-devnet',
    heartbeatSec: 60, freeHeap: 70000, largestBlock: 60000, uptime: 12, firmware: 'vendx-node test', ...over,
  });
/** 32 lowercase hex chars, like vendx::issueNonce(). */
const nodeNonce = () => Array.from(nacl.randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');

test('POST /api/nodes/register → 200 and the node appears in /api/devices as source esp32c3', async () => {
  _resetNodes();
  const r = await post('/api/nodes/register', registration());
  assert.equal(r.status, 200);
  const body = (await r.json()) as { ok: boolean; deviceId: string; registered: string; heartbeatSec: number };
  assert.equal(body.ok, true);
  assert.equal(body.deviceId, NODE_ID);
  assert.equal(body.registered, 'new');
  assert.equal(body.heartbeatSec, 60);

  const again = (await (await post('/api/nodes/heartbeat', registration())).json()) as { registered: string };
  assert.equal(again.registered, 'refreshed');

  const devices = (await (await get('/api/devices')).json()) as {
    devices: Array<{ id: string; source: string; url?: string; payTo?: string; nodeState?: string; priceUsd: number }>;
  };
  const node = devices.devices.find((d) => d.id === NODE_ID);
  assert.ok(node, 'node listed in the fleet');
  assert.equal(node.source, 'esp32c3');
  assert.equal(node.url, 'http://127.0.0.1:9');
  assert.equal(node.payTo, NODE_WALLET);
  assert.equal(node.nodeState, 'live');
  assert.equal(node.priceUsd, 0.01);
  // The simulator/badge device is still first.
  assert.notEqual(devices.devices[0].source, 'esp32c3');

  const detail = (await (await get(`/api/devices/${NODE_ID}`)).json()) as { device: { deviceId: string; source: string; heartbeats: number } };
  assert.equal(detail.device.deviceId, NODE_ID);
  assert.equal(detail.device.source, 'esp32c3');
  assert.equal(detail.device.heartbeats, 2);
});

test('POST /api/nodes/register rejects a registration without a wallet, price or http url', async () => {
  for (const bad of [{ payTo: 'not-a-wallet' }, { priceMicroUsdc: '0' }, { url: 'https://node.local' }, { source: 'simulator' }]) {
    const r = await post('/api/nodes/register', registration(bad));
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(((await r.json()) as { error: string }).error, 'bad_registration');
  }
});

test('/settle signs for a registered node\'s own nonce, over the REGISTERED payTo and price, and records an esp32c3 sale', async () => {
  _resetNodes();
  assert.equal((await post('/api/nodes/register', registration())).status, 200);
  const nonce = nodeNonce();
  const r = await post('/settle', JSON.stringify({
    nonce, txSignature: `SimTx_node_${nonce}`, payTo: NODE_WALLET, amount: '10000', network: 'solana-devnet', deviceId: NODE_ID,
  }));
  assert.equal(r.status, 200);
  const { receipt } = (await r.json()) as { receipt: string };
  const [b64] = receipt.split('.');
  const body = JSON.parse(Buffer.from(b64, 'base64url').toString()) as { nonce: string; payTo: string; amount: string };
  assert.equal(body.nonce, nonce);
  assert.equal(body.payTo, NODE_WALLET);
  assert.equal(body.amount, '10000');

  const sales = (await (await get('/api/sales')).json()) as { sales: Array<{ nonce: string; source: string; deviceId?: string }> };
  const sale = sales.sales.find((s) => s.nonce === nonce);
  assert.ok(sale);
  assert.equal(sale.source, 'esp32c3');
  assert.equal(sale.deviceId, NODE_ID);

  // The relay's own device must not accept a node receipt: the nonce is not in
  // its store, and the payTo is the node's wallet, not (necessarily) its own.
  // Either check may fire first; both are a refusal.
  const r2 = await get('/api/telemetry', { 'X-Payment-Receipt': receipt });
  assert.equal(r2.status, 402);
  assert.ok(['nonce_unknown', 'wrong_recipient'].includes(((await r2.json()) as { error: string }).error));

  // One receipt per node nonce, even with a fresh transaction.
  const dup = await post('/settle', JSON.stringify({
    nonce, txSignature: `SimTx_node_dup_${nonce}`, payTo: NODE_WALLET, amount: '10000', network: 'solana-devnet', deviceId: NODE_ID,
  }));
  assert.equal(dup.status, 402);
  assert.equal(((await dup.json()) as { errorReason: string }).errorReason, 'nonce_replayed');
});

test('/settle refuses a node nonce that underpays the registered price or names the wrong wallet', async () => {
  _resetNodes();
  assert.equal((await post('/api/nodes/register', registration())).status, 200);
  const under = await post('/settle', JSON.stringify({
    nonce: nodeNonce(), txSignature: 'SimTx_node_under', payTo: NODE_WALLET, amount: '100', network: 'solana-devnet', deviceId: NODE_ID,
  }));
  assert.equal(under.status, 402);
  assert.equal(((await under.json()) as { errorReason: string }).errorReason, 'insufficient_amount');

  const wrong = await post('/settle', JSON.stringify({
    nonce: nodeNonce(), txSignature: 'SimTx_node_wrong', payTo: VENDOR_WALLET === NODE_WALLET ? 'FHcgXc3YzNnq8WKcH8GaDvbKhJ4ycKxHnR7jzA8zAHU' : VENDOR_WALLET,
    amount: '10000', network: 'solana-devnet', deviceId: NODE_ID,
  }));
  assert.equal(wrong.status, 402);
  assert.equal(((await wrong.json()) as { errorReason: string }).errorReason, 'wrong_recipient');

  // An unregistered device id is still an unknown nonce.
  const ghost = await post('/settle', JSON.stringify({
    nonce: nodeNonce(), txSignature: 'SimTx_node_ghost', payTo: NODE_WALLET, amount: '10000', network: 'solana-devnet', deviceId: 'vendx-esp32c3-ghost',
  }));
  assert.equal(ghost.status, 402);
  assert.equal(((await ghost.json()) as { errorReason: string }).errorReason, 'nonce_unknown');
  _resetNodes();
});
