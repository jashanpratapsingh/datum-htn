/**
 * The sensor's books.
 *
 * Money flows out as well as in — that is the whole point. A device that only
 * collects is a paid API; a device that earns, pays its own operating costs, and
 * can run out of money is an economic actor.
 *
 * Amounts are micro-USDC as bigint throughout. Never floats: a cent lost to
 * binary rounding in a demo about money is not a good look.
 */

export interface Sale {
  at: number;
  microUsdc: bigint;
  nonce: string;
  payer: string | null;
  txSignature: string;
}

export interface Payout {
  at: number;
  microUsdc: bigint;
  /** True when this actually settled on-chain, false when only booked. */
  onChain: boolean;
  txSignature: string | null;
  note: string;
}

export interface BooksSnapshot {
  earnedMicroUsdc: string;
  spentMicroUsdc: string;
  netMicroUsdc: string;
  earnedUsd: number;
  spentUsd: number;
  netUsd: number;
  sales: number;
  payouts: number;
  lastSaleAt: number | null;
  /** True when the node cannot cover its next operating payment. */
  insolvent: boolean;
  nextBillDueAt: number;
  nextBillMicroUsdc: string;
}

export interface BooksOptions {
  /** How often the node owes its operating costs. */
  billIntervalMs?: number;
  /** What it owes each time, micro-USDC. */
  billMicroUsdc?: bigint;
  now?: () => number;
}

/** Deliberately small so the demo can actually reach insolvency on stage. */
export const DEFAULT_BILL_INTERVAL_MS = 30_000;
export const DEFAULT_BILL_MICRO_USDC = 20_000n; // $0.02 per interval

export type PayoutFn = (
  microUsdc: bigint,
) => Promise<{ onChain: boolean; txSignature: string | null; note: string }>;

export class Books {
  private readonly billIntervalMs: number;
  private readonly billMicroUsdc: bigint;
  private readonly now: () => number;

  private earned = 0n;
  private spent = 0n;
  private readonly sales: Sale[] = [];
  private readonly payouts: Payout[] = [];
  private nextBillDueAt: number;

  constructor(opts: BooksOptions = {}) {
    this.billIntervalMs = opts.billIntervalMs ?? DEFAULT_BILL_INTERVAL_MS;
    this.billMicroUsdc = opts.billMicroUsdc ?? DEFAULT_BILL_MICRO_USDC;
    this.now = opts.now ?? (() => Date.now());
    this.nextBillDueAt = this.now() + this.billIntervalMs;
  }

  recordSale(sale: Omit<Sale, 'at'> & { at?: number }): void {
    const entry: Sale = { ...sale, at: sale.at ?? this.now() };
    this.sales.push(entry);
    this.earned += entry.microUsdc;
  }

  get balance(): bigint {
    return this.earned - this.spent;
  }

  get lastSaleAt(): number | null {
    return this.sales.at(-1)?.at ?? null;
  }

  /** True when the next bill is due and cannot be covered from revenue. */
  get insolvent(): boolean {
    return this.now() >= this.nextBillDueAt && this.balance < this.billMicroUsdc;
  }

  billDue(): boolean {
    return this.now() >= this.nextBillDueAt;
  }

  /**
   * Pay the operating cost if it is due and affordable.
   *
   * Returns the payout, or null if nothing was owed. Throws nothing: a failed
   * on-chain transfer is booked as a non-on-chain payout with the reason, so the
   * demo degrades visibly instead of crashing.
   */
  async settleBill(pay: PayoutFn): Promise<Payout | null> {
    if (!this.billDue()) return null;
    if (this.balance < this.billMicroUsdc) {
      // Insolvent: leave the bill due so the state persists and is visible.
      return null;
    }

    const amount = this.billMicroUsdc;
    let outcome: { onChain: boolean; txSignature: string | null; note: string };
    try {
      outcome = await pay(amount);
    } catch (e) {
      outcome = { onChain: false, txSignature: null, note: `payout failed: ${(e as Error).message}` };
    }

    const payout: Payout = { at: this.now(), microUsdc: amount, ...outcome };
    this.payouts.push(payout);
    this.spent += amount;
    this.nextBillDueAt = this.now() + this.billIntervalMs;
    return payout;
  }

  recentPayouts(n = 5): readonly Payout[] {
    return this.payouts.slice(-n);
  }

  snapshot(): BooksSnapshot {
    const net = this.earned - this.spent;
    return {
      earnedMicroUsdc: this.earned.toString(),
      spentMicroUsdc: this.spent.toString(),
      netMicroUsdc: net.toString(),
      earnedUsd: Number(this.earned) / 1e6,
      spentUsd: Number(this.spent) / 1e6,
      netUsd: Number(net) / 1e6,
      sales: this.sales.length,
      payouts: this.payouts.length,
      lastSaleAt: this.lastSaleAt,
      insolvent: this.insolvent,
      nextBillDueAt: this.nextBillDueAt,
      nextBillMicroUsdc: this.billMicroUsdc.toString(),
    };
  }
}
