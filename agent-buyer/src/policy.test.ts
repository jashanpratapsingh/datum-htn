import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpendPolicy, DAY_CAP_MICRO_USDC } from './policy.js';

function tmpLedger(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vendx-policy-'));
  return { dir, file: join(dir, 'spend-ledger.json') };
}

test('daily cap trips after spending the full limit', () => {
  const { dir, file } = tmpLedger();
  try {
    const policy = new SpendPolicy(file);

    assert.ok(policy.canSpend(DAY_CAP_MICRO_USDC), 'fresh ledger should allow full-cap spend');

    policy.recordSpend(DAY_CAP_MICRO_USDC);

    assert.equal(policy.spentToday, DAY_CAP_MICRO_USDC);
    assert.equal(policy.remainingToday, 0n);
    assert.ok(!policy.canSpend(1n), 'cap is hit: even 1 µUSDC must be rejected');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('policy survives restart via the persisted ledger', () => {
  const { dir, file } = tmpLedger();
  try {
    const SPENT = 4_000_000n; // $4.00

    const policy1 = new SpendPolicy(file);
    policy1.recordSpend(SPENT);

    // Simulate restart: new instance reads the same ledger file
    const policy2 = new SpendPolicy(file);
    assert.equal(policy2.spentToday, SPENT, 'restarted policy should read persisted spend');
    assert.equal(policy2.remainingToday, DAY_CAP_MICRO_USDC - SPENT);

    // $1.00 fits; $1.00 + 1 µUSDC does not
    assert.ok(policy2.canSpend(1_000_000n));
    assert.ok(!policy2.canSpend(1_000_001n));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('per-request cap rejects an over-priced challenge on a fresh ledger', () => {
  const { dir, file } = tmpLedger();
  try {
    const policy = new SpendPolicy(file);

    // A single request exceeding the entire daily cap must be refused
    assert.ok(
      !policy.canSpend(DAY_CAP_MICRO_USDC + 1n),
      'over-priced challenge must be rejected even with zero prior spend',
    );

    // Exactly at the cap is still allowed
    assert.ok(policy.canSpend(DAY_CAP_MICRO_USDC));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('stale (yesterday) ledger is ignored and resets to zero', () => {
  const { dir, file } = tmpLedger();
  try {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    writeFileSync(file, JSON.stringify({ date: yesterday, spentMicroUsdc: '4999999' }));

    const policy = new SpendPolicy(file);
    assert.equal(policy.spentToday, 0n, 'yesterday ledger must be ignored');
    assert.ok(policy.canSpend(DAY_CAP_MICRO_USDC));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
