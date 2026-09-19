import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  usdToMicroUsdc,
  microUsdcToUsd,
  newNonce,
  buildChallenge,
  selectRequirements,
} from './challenge.js';
import {
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
  type PaymentRequiredBody,
  type PaymentRequirements,
} from './types.js';

/* ------------------------------------------------------------------ *
 * usdToMicroUsdc
 * ------------------------------------------------------------------ */

describe('usdToMicroUsdc', () => {
  it('0.01 => "10000"', () => {
    assert.equal(usdToMicroUsdc(0.01), '10000');
  });

  it('1.0 => "1000000"', () => {
    assert.equal(usdToMicroUsdc(1.0), '1000000');
  });

  it('0 => "0"', () => {
    assert.equal(usdToMicroUsdc(0), '0');
  });

  it('5.0 => "5000000"', () => {
    assert.equal(usdToMicroUsdc(5.0), '5000000');
  });

  it('negative throws RangeError', () => {
    assert.throws(() => usdToMicroUsdc(-0.01), RangeError);
  });

  it('NaN throws RangeError', () => {
    assert.throws(() => usdToMicroUsdc(NaN), RangeError);
  });

  it('Infinity throws RangeError', () => {
    assert.throws(() => usdToMicroUsdc(Infinity), RangeError);
  });

  it('rounding: 0.000001 => "1"', () => {
    assert.equal(usdToMicroUsdc(0.000001), '1');
  });
});

/* ------------------------------------------------------------------ *
 * microUsdcToUsd
 * ------------------------------------------------------------------ */

describe('microUsdcToUsd', () => {
  it('"1000000" => 1.0', () => {
    assert.equal(microUsdcToUsd('1000000'), 1.0);
  });

  it('10000 (number) ≈ 0.01', () => {
    assert.ok(Math.abs(microUsdcToUsd(10000) - 0.01) < 1e-9);
  });
});

/* ------------------------------------------------------------------ *
 * newNonce
 * ------------------------------------------------------------------ */

describe('newNonce', () => {
  it('returns a 32-char hex string', () => {
    const nonce = newNonce();
    assert.equal(nonce.length, 32);
    assert.ok(/^[0-9a-f]+$/.test(nonce), `not hex: ${nonce}`);
  });

  it('two consecutive calls return different values', () => {
    const a = newNonce();
    const b = newNonce();
    assert.notEqual(a, b);
  });
});

/* ------------------------------------------------------------------ *
 * buildChallenge
 * ------------------------------------------------------------------ */

describe('buildChallenge', () => {
  const baseInput = {
    resource: '/data',
    description: 'sensor telemetry',
    priceUsd: 0.01,
    payTo: 'FHcg1234walletBase58',
  };

  it('returns x402Version: 1', () => {
    const ch = buildChallenge(baseInput);
    assert.equal(ch.x402Version, 1);
  });

  it('accepts has exactly one entry with scheme "exact" and network "solana-devnet"', () => {
    const ch = buildChallenge(baseInput);
    assert.equal(ch.accepts.length, 1);
    assert.equal(ch.accepts[0].scheme, 'exact');
    assert.equal(ch.accepts[0].network, 'solana-devnet');
  });

  it('accepts[0].asset equals USDC_MINT_DEVNET by default', () => {
    const ch = buildChallenge(baseInput);
    assert.equal(ch.accepts[0].asset, USDC_MINT_DEVNET);
  });

  it('accepts[0].maxAmountRequired equals usdToMicroUsdc(priceUsd)', () => {
    const ch = buildChallenge(baseInput);
    assert.equal(ch.accepts[0].maxAmountRequired, usdToMicroUsdc(baseInput.priceUsd));
  });

  it('nonce is a 32-char hex string', () => {
    const ch = buildChallenge(baseInput);
    assert.equal(ch.nonce.length, 32);
    assert.ok(/^[0-9a-f]+$/.test(ch.nonce));
  });

  it('expiresAt is roughly now + ttlSeconds (within 5 seconds)', () => {
    const ttlSeconds = 300;
    const before = Math.floor(Date.now() / 1000);
    const ch = buildChallenge({ ...baseInput, ttlSeconds });
    const after = Math.floor(Date.now() / 1000);
    assert.ok(ch.expiresAt >= before + ttlSeconds);
    assert.ok(ch.expiresAt <= after + ttlSeconds + 5);
  });

  it('with network "solana", accepts[0].asset equals USDC_MINT_MAINNET', () => {
    const ch = buildChallenge({ ...baseInput, network: 'solana' });
    assert.equal(ch.accepts[0].asset, USDC_MINT_MAINNET);
  });

  it('error field equals "Payment Required"', () => {
    const ch = buildChallenge(baseInput);
    assert.equal(ch.error, 'Payment Required');
  });
});

/* ------------------------------------------------------------------ *
 * selectRequirements
 * ------------------------------------------------------------------ */

describe('selectRequirements', () => {
  function makeReqs(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
    return {
      scheme: 'exact',
      network: 'solana-devnet',
      maxAmountRequired: '10000',
      resource: '/data',
      description: 'test',
      mimeType: 'application/json',
      outputSchema: null,
      payTo: 'FHcg1234',
      maxTimeoutSeconds: 300,
      asset: USDC_MINT_DEVNET,
      extra: null,
      ...overrides,
    };
  }

  function makeBody(accepts: PaymentRequirements[]): PaymentRequiredBody {
    return {
      x402Version: 1,
      error: 'Payment Required',
      accepts,
      nonce: 'aabbccdd11223344',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  }

  const defaultOpts = {
    network: 'solana-devnet' as const,
    asset: USDC_MINT_DEVNET,
    maxMicroUsdc: 10000n,
  };

  it('returns the matching PaymentRequirements for a valid body', () => {
    const r = makeReqs();
    const body = makeBody([r]);
    assert.deepEqual(selectRequirements(body, defaultOpts), r);
  });

  it('returns null if network does not match', () => {
    const r = makeReqs({ network: 'solana' });
    const body = makeBody([r]);
    assert.equal(selectRequirements(body, defaultOpts), null);
  });

  it('returns null if asset does not match', () => {
    const r = makeReqs({ asset: USDC_MINT_MAINNET });
    const body = makeBody([r]);
    assert.equal(selectRequirements(body, defaultOpts), null);
  });

  it('returns null if maxAmountRequired > maxMicroUsdc (too expensive)', () => {
    const r = makeReqs({ maxAmountRequired: '20000' });
    const body = makeBody([r]);
    assert.equal(selectRequirements(body, defaultOpts), null);
  });

  it('exactly at the limit still returns a match', () => {
    const r = makeReqs({ maxAmountRequired: '10000' });
    const body = makeBody([r]);
    assert.deepEqual(selectRequirements(body, defaultOpts), r);
  });

  it('returns null if scheme is not "exact"', () => {
    const r = makeReqs({ scheme: 'exact' });
    // Override scheme to something invalid for the select function
    const badScheme = { ...r, scheme: 'other' } as unknown as PaymentRequirements;
    const body = makeBody([badScheme]);
    assert.equal(selectRequirements(body, defaultOpts), null);
  });

  it('returns null for an empty accepts array', () => {
    const body = makeBody([]);
    assert.equal(selectRequirements(body, defaultOpts), null);
  });

  it('returns the FIRST match when multiple requirements are present', () => {
    const wrongNetwork: PaymentRequirements = makeReqs({ network: 'solana' });
    const correct: PaymentRequirements = makeReqs();
    const body = makeBody([wrongNetwork, correct]);
    const result = selectRequirements(body, defaultOpts);
    assert.deepEqual(result, correct);
  });
});
