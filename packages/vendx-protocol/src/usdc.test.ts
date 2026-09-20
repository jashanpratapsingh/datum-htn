import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsdc, formatUsdcMicro, formatUsdDisplay } from './usdc.js';

describe('formatUsdcMicro', () => {
  it('keeps two decimals for round amounts', () => {
    assert.equal(formatUsdcMicro(0n), '0.00');
    assert.equal(formatUsdcMicro(1_500_000n), '1.50');
    assert.equal(formatUsdcMicro('10000000'), '10.00');
  });

  it('shows the digits that make a 100 µUSDC sale visible', () => {
    assert.equal(formatUsdcMicro(100n), '0.0001');
    assert.equal(formatUsdcMicro('1200'), '0.0012');
    assert.equal(formatUsdcMicro(9_999_800n), '9.9998');
  });

  it('accepts decimal strings without going through a float', () => {
    assert.equal(formatUsdcMicro('1234567890'), '1,234.56789');
    assert.equal(formatUsdcMicro('9007199254740993'), '9,007,199,254.740993');
  });

  it('handles negatives and plain numbers', () => {
    assert.equal(formatUsdcMicro(-100n), '-0.0001');
    assert.equal(formatUsdcMicro(2500), '0.0025');
    assert.equal(formatUsdc(0.0001), '0.0001');
  });
});

describe('formatUsdDisplay', () => {
  it('prefixes a dollar sign', () => {
    assert.equal(formatUsdDisplay(0n), '$0.00');
    assert.equal(formatUsdDisplay('100'), '$0.0001');
    assert.equal(formatUsdDisplay(1_500_000n), '$1.50');
  });
});
