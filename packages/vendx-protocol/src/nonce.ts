import { newNonce } from './challenge.js';

/**
 * The device's ticket stub book.
 *
 * A nonce is minted when the device answers 402 and burned the first time a
 * receipt discharges it. This is what makes replay defence possible without the
 * device holding a payment history or talking to an RPC — see docs/PROTOCOL.md.
 *
 * Deliberately a FIXED-CAPACITY ring, not a growing Map. The ESP32 mirrors this
 * file in C with a static array and no allocator, so the TypeScript reference
 * must not rely on unbounded growth. When the ring is full the oldest slot is
 * reused, which means a nonce can expire early under flood — that is the
 * correct failure mode for a device with 320 KB of SRAM: refuse service rather
 * than exhaust memory.
 */

export interface NonceSlot {
  nonce: string;
  /** Unix seconds. */
  expiresAt: number;
  used: boolean;
}

export type NonceState = 'valid' | 'unknown' | 'replayed' | 'expired';

export const DEFAULT_NONCE_CAPACITY = 32;
export const DEFAULT_NONCE_TTL_SECONDS = 300;

export interface NonceStoreOptions {
  capacity?: number;
  ttlSeconds?: number;
  /** Injectable clock, in unix seconds. Keeps tests deterministic. */
  now?: () => number;
}

export class NonceStore {
  private readonly slots: (NonceSlot | null)[];
  private readonly ttlSeconds: number;
  private readonly now: () => number;
  private cursor = 0;

  constructor(opts: NonceStoreOptions = {}) {
    const capacity = opts.capacity ?? DEFAULT_NONCE_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`nonce capacity must be a positive integer, got ${capacity}`);
    }
    this.slots = new Array<NonceSlot | null>(capacity).fill(null);
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_NONCE_TTL_SECONDS;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  get capacity(): number {
    return this.slots.length;
  }

  /** Mint a nonce and take a slot for it. Returns the nonce and its expiry. */
  issue(): { nonce: string; expiresAt: number } {
    const nonce = newNonce();
    const expiresAt = this.now() + this.ttlSeconds;

    // Prefer a free or dead slot before evicting anything still live.
    let index = this.slots.findIndex((s) => s === null || s.used || s.expiresAt <= this.now());
    if (index < 0) {
      index = this.cursor;
      this.cursor = (this.cursor + 1) % this.slots.length;
    }

    this.slots[index] = { nonce, expiresAt, used: false };
    return { nonce, expiresAt };
  }

  /** Classify a nonce without consuming it. */
  check(nonce: string): NonceState {
    const slot = this.find(nonce);
    if (!slot) return 'unknown';
    if (slot.used) return 'replayed';
    if (slot.expiresAt <= this.now()) return 'expired';
    return 'valid';
  }

  /**
   * Consume a nonce. Returns the state it was in *before* the attempt, so the
   * caller can map it straight onto a VerifyFailure. Only a `valid` nonce is
   * actually burned.
   */
  burn(nonce: string): NonceState {
    const state = this.check(nonce);
    if (state === 'valid') {
      const slot = this.find(nonce);
      if (slot) slot.used = true;
    }
    return state;
  }

  /** Drop expired and used slots. Cheap; safe to call on every request. */
  sweep(): number {
    const cutoff = this.now();
    let freed = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot && (slot.used || slot.expiresAt <= cutoff)) {
        this.slots[i] = null;
        freed++;
      }
    }
    return freed;
  }

  /** Live, unburned, unexpired slots. For /health and the dashboard. */
  outstanding(): number {
    const cutoff = this.now();
    let n = 0;
    for (const slot of this.slots) {
      if (slot && !slot.used && slot.expiresAt > cutoff) n++;
    }
    return n;
  }

  private find(nonce: string): NonceSlot | undefined {
    for (const slot of this.slots) {
      if (slot && slot.nonce === nonce) return slot;
    }
    return undefined;
  }
}
