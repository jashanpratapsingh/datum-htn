/**
 * Persistence store unit tests — in-memory default must keep working offline.
 * Supabase write-through is skipped unless SUPABASE_URL is set (never required for CI).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueNonce, consumeNonce } from './nonce-store.js';
import { recordSale, getSales } from './sales-log.js';
import { supabaseEnabled } from './supabase.js';

test('supabaseEnabled is false without env (demo default)', () => {
  assert.equal(supabaseEnabled(), false);
});

test('issue + consume nonce once; replay fails', () => {
  const nonce = `test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  issueNonce(nonce, {
    expiresAt,
    used: false,
    payTo: 'Vendor111111111111111111111111111111111',
    amountMicroUsdc: '10000',
  });
  const first = consumeNonce(nonce);
  assert.equal(first.ok, true);
  const second = consumeNonce(nonce);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'nonce_replayed');
});

test('unknown nonce → nonce_unknown', () => {
  const r = consumeNonce('never-issued-nonce-zzzz');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'nonce_unknown');
});

test('recordSale prepends and getSales returns it', () => {
  const before = getSales().length;
  const id = `sale-${Date.now()}`;
  recordSale({
    id,
    nonce: 'n1',
    amountMicroUsdc: '10000',
    timestamp: Math.floor(Date.now() / 1000),
    txSignature: 'SIG',
    source: 'simulator',
  });
  const sales = getSales();
  assert.ok(sales.length >= before + 1);
  assert.equal(sales[0]?.id, id);
});
