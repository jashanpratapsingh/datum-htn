/**
 * Cumulative crossings — the headline number VENDX sells.
 *
 * Nothing upstream provides this. RuView's `n_persons` and the sensing server's
 * `estimated_persons` are both *instantaneous* occupancy, and the only cumulative
 * counter in that project (`ret_customer_flow.rs`) needs 20 Hz CSI phase data.
 *
 * Counting raw presence events would be wrong. RuView's presence flag asserts
 * with no debounce at all:
 *
 *     if (score > threshold) { *below_count = 0; return true; }   // ENTER: immediate
 *     — firmware/esp32-csi-node/main/edge_processing.c:507-510
 *
 * and its own README warns presence "**will** false-positive under strong RF
 * interference from non-human sources (fans near the antenna, microwave duty
 * cycles, neighbouring AP power swings)". A microwave would become a customer.
 *
 * So a crossing here requires a shape, not a spike:
 *
 *   1. energy rises above `enterThreshold`
 *   2. it STAYS above for at least `sustainMs`      <- rejects impulses
 *   3. it falls back below `exitThreshold`          <- hysteresis, not one line
 *   4. `refractoryMs` elapses before the next count <- rejects oscillation
 *
 * This is still a heuristic and is labelled as one everywhere it surfaces.
 */

export interface FootfallOptions {
  /** Motion energy that opens a candidate crossing. */
  enterThreshold?: number;
  /** Motion energy that closes it. Must be below enterThreshold. */
  exitThreshold?: number;
  /** Minimum time above enterThreshold to count as a body, not a glitch. */
  sustainMs?: number;
  /** Dead time after a completed crossing. */
  refractoryMs?: number;
  now?: () => number;
}

export const DEFAULT_ENTER_THRESHOLD = 0.1; // RuView's "Moderate" band
export const DEFAULT_EXIT_THRESHOLD = 0.05;
export const DEFAULT_SUSTAIN_MS = 700;
export const DEFAULT_REFRACTORY_MS = 2_000;

export interface FootfallState {
  /** Crossings counted in the current local day. */
  today: number;
  /** Crossings since the counter was created, across day boundaries. */
  total: number;
  /** Local date key the `today` figure belongs to, YYYY-MM-DD. */
  day: string;
  /** True while a candidate crossing is open. */
  tracking: boolean;
  /** Candidate crossings discarded for failing the sustain test. */
  rejectedImpulses: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'rising'; since: number }
  | { kind: 'confirmed' }
  | { kind: 'refractory'; until: number };

export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class FootfallCounter {
  private readonly enterThreshold: number;
  private readonly exitThreshold: number;
  private readonly sustainMs: number;
  private readonly refractoryMs: number;
  private readonly now: () => number;

  private phase: Phase = { kind: 'idle' };
  private today = 0;
  private total = 0;
  private day: string;
  private rejectedImpulses = 0;

  constructor(opts: FootfallOptions = {}) {
    this.enterThreshold = opts.enterThreshold ?? DEFAULT_ENTER_THRESHOLD;
    this.exitThreshold = opts.exitThreshold ?? DEFAULT_EXIT_THRESHOLD;
    this.sustainMs = opts.sustainMs ?? DEFAULT_SUSTAIN_MS;
    this.refractoryMs = opts.refractoryMs ?? DEFAULT_REFRACTORY_MS;
    this.now = opts.now ?? (() => Date.now());

    if (this.exitThreshold >= this.enterThreshold) {
      throw new RangeError('exitThreshold must be below enterThreshold for hysteresis');
    }
    this.day = localDayKey(this.now());
  }

  /** Feed one motion energy sample. Returns true if a crossing was counted. */
  observe(energy: number): boolean {
    const t = this.now();
    this.rollDay(t);

    switch (this.phase.kind) {
      case 'refractory':
        if (t >= this.phase.until) this.phase = { kind: 'idle' };
        return false;

      case 'idle':
        if (energy >= this.enterThreshold) this.phase = { kind: 'rising', since: t };
        return false;

      case 'rising':
        if (energy < this.exitThreshold) {
          // Dropped out before sustaining: an impulse, not a body.
          this.rejectedImpulses++;
          this.phase = { kind: 'idle' };
          return false;
        }
        if (energy >= this.enterThreshold && t - this.phase.since >= this.sustainMs) {
          this.phase = { kind: 'confirmed' };
        }
        return false;

      case 'confirmed':
        // Count on the trailing edge: the body has passed through.
        if (energy < this.exitThreshold) {
          this.today++;
          this.total++;
          this.phase = { kind: 'refractory', until: t + this.refractoryMs };
          return true;
        }
        return false;
    }
  }

  state(): FootfallState {
    this.rollDay(this.now());
    return {
      today: this.today,
      total: this.total,
      day: this.day,
      tracking: this.phase.kind === 'rising' || this.phase.kind === 'confirmed',
      rejectedImpulses: this.rejectedImpulses,
    };
  }

  /** Restore a persisted count so a restart does not zero the day. */
  restore(snapshot: Pick<FootfallState, 'today' | 'total' | 'day'>): void {
    this.today = Math.max(0, Math.floor(snapshot.today));
    this.total = Math.max(0, Math.floor(snapshot.total));
    this.day = snapshot.day;
    this.rollDay(this.now());
  }

  private rollDay(t: number): void {
    const key = localDayKey(t);
    if (key !== this.day) {
      this.day = key;
      this.today = 0;
    }
  }
}
