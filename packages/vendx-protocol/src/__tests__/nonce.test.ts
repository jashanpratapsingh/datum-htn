import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NonceStore } from '../nonce.js';

/**
 * The ring is what makes this portable to a device with no allocator, so the
 * bounded-memory behaviour is part of the contract and not an implementation
 * detail.
 */

function store(capacity: number, ttlSeconds = 300) {
  let t = 1_000_000;
  const s = new NonceStore({ capacity, ttlSeconds, now: () => t });
  return {
    s,
    advance: (sec: number) => {
      t += sec;
    },
  };
}

test('an issued nonce is valid, and burning it once spends it', () => {
  const { s } = store(8);
  const { nonce } = s.issue();
  assert.equal(s.check(nonce), 'valid');
  assert.equal(s.burn(nonce), 'valid');
  assert.equal(s.check(nonce), 'replayed');
  assert.equal(s.burn(nonce), 'replayed', 'a second burn reports the replay');
});

test('an unknown nonce is never valid', () => {
  const { s } = store(8);
  assert.equal(s.check('never-issued'), 'unknown');
  assert.equal(s.burn('never-issued'), 'unknown');
});

test('checking does not consume', () => {
  const { s } = store(8);
  const { nonce } = s.issue();
  for (let i = 0; i < 10; i++) assert.equal(s.check(nonce), 'valid');
  assert.equal(s.burn(nonce), 'valid');
});

test('a nonce expires on its TTL', () => {
  const { s, advance } = store(8, 60);
  const { nonce, expiresAt } = s.issue();
  advance(59);
  assert.equal(s.check(nonce), 'valid');
  advance(2);
  assert.equal(s.check(nonce), 'expired');
  assert.equal(s.burn(nonce), 'expired');
  assert.equal(typeof expiresAt, 'number');
});

test('issued nonces are distinct', () => {
  const { s } = store(64);
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) seen.add(s.issue().nonce);
  assert.equal(seen.size, 50);
});

test('capacity is respected and the oldest live slot is evicted under flood', () => {
  const { s } = store(4);
  const first = s.issue().nonce;
  const kept = [s.issue().nonce, s.issue().nonce, s.issue().nonce];
  assert.equal(s.capacity, 4);
  assert.equal(s.outstanding(), 4);

  // A fifth nonce must displace one rather than grow the store. Refusing service
  // is the correct failure mode on 320 KB of SRAM.
  const fifth = s.issue().nonce;
  assert.equal(s.outstanding(), 4, 'the ring must not grow');
  assert.equal(s.check(fifth), 'valid');
  assert.equal(s.check(first), 'unknown', 'the oldest slot was reused');
  for (const n of kept) assert.equal(s.check(n), 'valid');
});

test('a dead slot is reused before anything live is evicted', () => {
  const { s } = store(3);
  const a = s.issue().nonce;
  const b = s.issue().nonce;
  const c = s.issue().nonce;
  s.burn(b); // b's slot is now dead

  const d = s.issue().nonce;
  assert.equal(s.check(a), 'valid', 'a live nonce must survive');
  assert.equal(s.check(c), 'valid', 'a live nonce must survive');
  assert.equal(s.check(d), 'valid');
});

test('sweep frees used and expired slots', () => {
  const { s, advance } = store(8, 60);
  const live = s.issue().nonce;
  const spent = s.issue().nonce;
  s.burn(spent);
  assert.equal(s.outstanding(), 1);

  assert.equal(s.sweep(), 1, 'the spent slot is reclaimed');
  assert.equal(s.check(live), 'valid');
  assert.equal(s.check(spent), 'unknown');

  advance(120);
  assert.equal(s.sweep(), 1, 'the expired slot is reclaimed');
  assert.equal(s.outstanding(), 0);
});

test('outstanding counts only live slots', () => {
  const { s, advance } = store(8, 60);
  const a = s.issue().nonce;
  s.issue();
  assert.equal(s.outstanding(), 2);
  s.burn(a);
  assert.equal(s.outstanding(), 1);
  advance(120);
  assert.equal(s.outstanding(), 0);
});

test('a nonsensical capacity is refused at construction', () => {
  assert.throws(() => new NonceStore({ capacity: 0 }), RangeError);
  assert.throws(() => new NonceStore({ capacity: -1 }), RangeError);
  assert.throws(() => new NonceStore({ capacity: 2.5 }), RangeError);
});
