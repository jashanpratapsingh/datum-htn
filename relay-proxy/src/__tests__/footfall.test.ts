import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FootfallCounter, localDayKey } from '../footfall.js';

interface Clock {
  now: () => number;
  advance: (ms: number) => number;
}

function clock(start: number = Date.UTC(2026, 8, 19, 12, 0, 0)): Clock {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** enter 0.10, exit 0.05, sustain 700ms, refractory 2000ms. */
function counter(c: Clock): FootfallCounter {
  return new FootfallCounter({ now: c.now });
}

test('a sustained pass-through counts exactly one crossing', () => {
  const c = clock();
  const f = counter(c);

  assert.equal(f.observe(0.01), false); // idle
  assert.equal(f.observe(0.2), false); // rising starts
  c.advance(800); // sustain satisfied
  assert.equal(f.observe(0.25), false); // confirmed
  assert.equal(f.observe(0.01), true); // trailing edge counts
  assert.equal(f.state().today, 1);
});

test('an impulse spike does not count', () => {
  const c = clock();
  const f = counter(c);

  f.observe(0.4); // rising
  c.advance(100); // nowhere near the 700ms sustain
  assert.equal(f.observe(0.0), false); // dropped out
  assert.equal(f.state().today, 0);
  assert.equal(f.state().rejectedImpulses, 1);
});

test('a microwave cycling on and off never accumulates count', () => {
  const c = clock();
  const f = counter(c);

  // Short bursts, none sustained: exactly the false-positive RuView warns about.
  for (let i = 0; i < 40; i++) {
    f.observe(0.5);
    c.advance(200);
    f.observe(0.0);
    c.advance(200);
  }
  assert.equal(f.state().today, 0);
});

test('hysteresis stops a single crossing being counted twice', () => {
  const c = clock();
  const f = counter(c);

  f.observe(0.2);
  c.advance(800);
  f.observe(0.2); // confirmed

  // Energy wobbles in the dead band between exit and enter: not a new event.
  assert.equal(f.observe(0.07), false);
  assert.equal(f.observe(0.09), false);
  assert.equal(f.observe(0.2), false);
  assert.equal(f.observe(0.01), true); // one count, on the real trailing edge
  assert.equal(f.state().today, 1);
});

test('the refractory gap suppresses an immediate second count', () => {
  const c = clock();
  const f = counter(c);

  const cross = (): boolean => {
    f.observe(0.3);
    c.advance(800);
    f.observe(0.3);
    return f.observe(0.0);
  };

  assert.equal(cross(), true);

  // Straight back into motion while still in the dead time.
  c.advance(100);
  f.observe(0.3);
  c.advance(800);
  f.observe(0.3);
  assert.equal(f.observe(0.0), false, 'suppressed inside refractory window');
  assert.equal(f.state().today, 1);
});

test('two genuinely separate crossings both count', () => {
  const c = clock();
  const f = counter(c);

  const cross = (): boolean => {
    f.observe(0.3);
    c.advance(800);
    f.observe(0.3);
    return f.observe(0.0);
  };

  assert.equal(cross(), true);
  c.advance(3_000); // past the refractory window
  f.observe(0.0); // clears refractory
  assert.equal(cross(), true);
  assert.equal(f.state().today, 2);
});

test('the daily figure resets at local midnight but the total does not', () => {
  const c = clock(new Date(2026, 8, 19, 23, 59, 0).getTime());
  const f = counter(c);

  f.observe(0.3);
  c.advance(800);
  f.observe(0.3);
  assert.equal(f.observe(0.0), true);
  assert.equal(f.state().today, 1);
  assert.equal(f.state().total, 1);

  c.advance(2 * 60 * 1000); // cross midnight
  const s = f.state();
  assert.equal(s.today, 0, 'day rolled');
  assert.equal(s.total, 1, 'lifetime total kept');
  assert.equal(s.day, localDayKey(c.now()));
});

test('restore brings back a persisted day, and a stale day is discarded', () => {
  const c = clock();
  const f = counter(c);

  f.restore({ today: 41, total: 500, day: localDayKey(c.now()) });
  assert.equal(f.state().today, 41);

  f.restore({ today: 41, total: 500, day: '2020-01-01' });
  assert.equal(f.state().today, 0, 'a count from another day must not carry over');
  assert.equal(f.state().total, 500);
});

test('thresholds must provide hysteresis', () => {
  assert.throws(
    () => new FootfallCounter({ enterThreshold: 0.1, exitThreshold: 0.1 }),
    RangeError,
  );
  assert.throws(
    () => new FootfallCounter({ enterThreshold: 0.05, exitThreshold: 0.2 }),
    RangeError,
  );
});

test('tracking reports an open candidate', () => {
  const c = clock();
  const f = counter(c);

  assert.equal(f.state().tracking, false);
  f.observe(0.3);
  assert.equal(f.state().tracking, true);
  f.observe(0.0);
  assert.equal(f.state().tracking, false);
});
