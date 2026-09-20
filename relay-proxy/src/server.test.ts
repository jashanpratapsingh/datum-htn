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
import { MemoryStore } from './store/index.js';
import { hashAgentKey, AGENT_KEY_HEADER } from './agent-auth.js';
import { signReceipt, encodeReceipt } from '@vendx/protocol';
import nacl from 'tweetnacl';

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

// A registered agent, as the website would have minted it, seeded into the
// memory store so API-key attribution is exercised without Supabase.
const TEST_KEY = 'vendx_sk_' + 'A'.repeat(43);
const TEST_AGENT = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'test-agent',
  keyPrefix: TEST_KEY.slice(0, 17),
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  revokedAt: null,
};
const REVOKED_KEY = 'vendx_sk_' + 'B'.repeat(43);
const store = new MemoryStore();
store.seedAgent({ ...TEST_AGENT, keyHash: hashAgentKey(TEST_KEY) });
store.seedAgent({
  ...TEST_AGENT,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'revoked-agent',
  revokedAt: new Date().toISOString(),
  keyHash: hashAgentKey(REVOKED_KEY),
});
const server = createRelayServer(0, { store, espectreDiscovery: false });
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

test('GET /api/policy?payer= → per-wallet spend from settled sales, zero for a stranger', async () => {
  // Trust mode (these tests) records every payer as 'unverified'; the filter
  // mechanics are the same as for a real wallet in verify mode. Own nonce and
  // a fresh txSignature: the relay refuses to settle a signature twice.
  const r1 = await get('/api/telemetry');
  assert.equal(r1.status, 402);
  const { nonce } = (await r1.json()) as { nonce: string };
  const r2 = await post(
    '/settle',
    JSON.stringify({ nonce, txSignature: `SimTx_payer_${Date.now()}`, payTo: VENDOR_WALLET, amount: '100', network: 'solana-devnet' }),
  );
  assert.equal(r2.status, 200);
  const mine = (await (await get('/api/policy?payer=unverified')).json()) as {
    payersVerified: boolean;
    payer: { wallet: string; spentMicroUsdc: string; remainingMicroUsdc: string; sales: number; date: string };
  };
  assert.equal(mine.payersVerified, false);
  assert.equal(mine.payer.wallet, 'unverified');
  assert.ok(mine.payer.sales >= 1);
  assert.ok(BigInt(mine.payer.spentMicroUsdc) >= 100n);
  assert.equal(BigInt(mine.payer.spentMicroUsdc) + BigInt(mine.payer.remainingMicroUsdc), 5_000_000n);
  assert.equal(mine.payer.date, new Date().toISOString().slice(0, 10));

  const stranger = (await (await get('/api/policy?payer=11111111111111111111111111111111')).json()) as {
    payer: { spentMicroUsdc: string; sales: number };
  };
  assert.equal(stranger.payer.spentMicroUsdc, '0');
  assert.equal(stranger.payer.sales, 0);

  const plain = (await (await get('/api/policy')).json()) as { payer?: unknown };
  assert.equal(plain.payer, undefined);
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
// Persistence layer, attribution, directory
// ---------------------------------------------------------------------------

test('GET /health reports persistence: memory and a heartbeat object', async () => {
  const res = await get('/health');
  const body = (await res.json()) as { persistence: string; heartbeat: { count: number }; relayId: string };
  assert.equal(body.persistence, 'memory');
  assert.equal(typeof body.heartbeat.count, 'number');
  assert.match(body.relayId, /^[0-9a-f]{64}$/);
});

test('OPTIONS preflight allows the agent key header', async () => {
  const res = await fetch(`${BASE}/settle`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('Access-Control-Allow-Headers') ?? '', /x-vendx-agent-key/i);
});

test('GET /api/sales entries never include the receipt', async () => {
  const r1 = await get('/api/telemetry');
  const { nonce } = (await r1.json()) as { nonce: string };
  const settled = await settleWithHeaders(nonce, `SimTx_sales_${nonce.slice(0, 6)}`, {});
  assert.equal(settled.status, 200);
  const res = await get('/api/sales');
  const body = (await res.json()) as { sales: Array<Record<string, unknown>> };
  assert.ok(body.sales.length >= 1);
  for (const s of body.sales) assert.equal('receipt' in s, false);
});

async function settleWithHeaders(nonce: string, txSignature: string, headers: Record<string, string>) {
  return fetch(`${BASE}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ nonce, txSignature, payTo: VENDOR_WALLET, amount: '100', network: 'solana-devnet' }),
  });
}

test('POST /settle with a registered key → attribution: agent, visible in /api/me/purchases', async () => {
  const r1 = await get('/api/telemetry', { [AGENT_KEY_HEADER]: TEST_KEY });
  assert.equal(r1.status, 402);
  const { nonce } = (await r1.json()) as { nonce: string };
  const r2 = await settleWithHeaders(nonce, `SimTx_attributed_${nonce.slice(0, 6)}`, { [AGENT_KEY_HEADER]: TEST_KEY });
  assert.equal(r2.status, 200);
  const settled = (await r2.json()) as { attribution: string; receipt: string };
  assert.equal(settled.attribution, 'agent');

  const me = await get('/api/me', { [AGENT_KEY_HEADER]: TEST_KEY });
  assert.equal(me.status, 200);
  const meBody = (await me.json()) as { agent: { name: string }; userId: string };
  assert.equal(meBody.agent.name, 'test-agent');
  assert.equal(meBody.userId, TEST_AGENT.userId);

  const p = await get('/api/me/purchases', { [AGENT_KEY_HEADER]: TEST_KEY });
  assert.equal(p.status, 200);
  const pBody = (await p.json()) as { purchases: Array<{ nonce: string; receipt?: string; solscanUrl: string }> };
  const mine = pBody.purchases.find((x) => x.nonce === nonce);
  assert.ok(mine, 'purchase listed for the agent');
  assert.equal(mine.receipt, settled.receipt);
  assert.match(mine.solscanUrl, /solscan\.io/);
});

test('POST /settle with an unknown key still settles → attribution: unknown_key', async () => {
  const r1 = await get('/api/telemetry');
  const { nonce } = (await r1.json()) as { nonce: string };
  const unknown = 'vendx_sk_' + 'Z'.repeat(43);
  const r2 = await settleWithHeaders(nonce, `SimTx_unknown_${nonce.slice(0, 6)}`, { [AGENT_KEY_HEADER]: unknown });
  assert.equal(r2.status, 200);
  const body = (await r2.json()) as { attribution: string };
  assert.equal(body.attribution, 'unknown_key');
  const p = await get('/api/me/purchases', { [AGENT_KEY_HEADER]: TEST_KEY });
  const pBody = (await p.json()) as { purchases: Array<{ nonce: string }> };
  assert.equal(pBody.purchases.some((x) => x.nonce === nonce), false);
});

test('GET /api/telemetry (402 path) with an unknown or malformed key → 401 bad_agent_key', async () => {
  const r1 = await get('/api/telemetry', { [AGENT_KEY_HEADER]: 'vendx_sk_' + 'Q'.repeat(43) });
  assert.equal(r1.status, 401);
  assert.equal(((await r1.json()) as { error: string }).error, 'bad_agent_key');
  const r2 = await get('/api/telemetry', { [AGENT_KEY_HEADER]: 'not-a-key' });
  assert.equal(r2.status, 401);
  const r3 = await get('/api/telemetry', { [AGENT_KEY_HEADER]: REVOKED_KEY });
  assert.equal(r3.status, 401);
  assert.equal(((await r3.json()) as { error: string }).error, 'agent_revoked');
});

test('GET /api/me without a key → 401 missing_agent_key; unknown key → 401', async () => {
  const r1 = await get('/api/me');
  assert.equal(r1.status, 401);
  assert.equal(((await r1.json()) as { error: string }).error, 'missing_agent_key');
  const r2 = await get('/api/me', { [AGENT_KEY_HEADER]: 'vendx_sk_' + 'Y'.repeat(43) });
  assert.equal(r2.status, 401);
});

test('POST /settle twice with the same nonce and txSignature → same receipt, idempotent: true', async () => {
  const r1 = await get('/api/telemetry');
  const { nonce } = (await r1.json()) as { nonce: string };
  const sig = `SimTx_retry_${nonce.slice(0, 6)}`;
  const a = await settleWithHeaders(nonce, sig, {});
  assert.equal(a.status, 200);
  const aBody = (await a.json()) as { receipt: string; idempotent?: boolean };
  const b = await settleWithHeaders(nonce, sig, {});
  assert.equal(b.status, 200);
  const bBody = (await b.json()) as { receipt: string; idempotent?: boolean };
  assert.equal(bBody.receipt, aBody.receipt);
  assert.equal(bBody.idempotent, true);
  assert.equal(aBody.idempotent, undefined);
});

test('POST /settle for a settled nonce with a different txSignature → 402 nonce_replayed', async () => {
  const r1 = await get('/api/telemetry');
  const { nonce } = (await r1.json()) as { nonce: string };
  const a = await settleWithHeaders(nonce, `SimTx_first_${nonce.slice(0, 6)}`, {});
  assert.equal(a.status, 200);
  const b = await settleWithHeaders(nonce, `SimTx_second_${nonce.slice(0, 6)}`, {});
  assert.equal(b.status, 402);
  assert.equal(((await b.json()) as { errorReason: string }).errorReason, 'nonce_replayed');
});

test('GET /api/directory lists this relay and its device after the first heartbeat', async () => {
  let body: { relays: Array<{ id: string; state: string }>; devices: Array<{ id: string }> } = { relays: [], devices: [] };
  for (let i = 0; i < 40 && body.relays.length === 0; i++) {
    body = (await (await get('/api/directory')).json()) as typeof body;
    if (body.relays.length === 0) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(body.relays.length, 1);
  assert.match(body.relays[0].id, /^[0-9a-f]{64}$/);
  assert.equal(body.relays[0].state, 'live');
  const devices = (await (await get('/api/devices')).json()) as { devices: Array<{ id: string }> };
  assert.equal(body.devices[0].id, devices.devices[0].id);
});

test('POST /settle with the web secret + x-vendx-agent-id → sale attributed to that agent', async () => {
  process.env.VENDX_WEB_SECRET = 'test-web-secret';
  try {
    const r1 = await get('/api/telemetry');
    const { nonce } = (await r1.json()) as { nonce: string };
    const r2 = await settleWithHeaders(nonce, `SimTx_webagent_${nonce.slice(0, 6)}`, {
      'x-vendx-web-secret': 'test-web-secret',
      'x-vendx-user-id': TEST_AGENT.userId,
      'x-vendx-agent-id': TEST_AGENT.id,
    });
    assert.equal(r2.status, 200);
    const settled = (await r2.json()) as { attribution: string };
    assert.equal(settled.attribution, 'web');
    const p = await get('/api/me/purchases', { [AGENT_KEY_HEADER]: TEST_KEY });
    const pBody = (await p.json()) as { purchases: Array<{ nonce: string; agentId?: string | null }> };
    const mine = pBody.purchases.find((x) => x.nonce === nonce);
    assert.ok(mine, 'the web-side purchase is listed under the named agent');
  } finally {
    delete process.env.VENDX_WEB_SECRET;
  }
});
