/**
 * The rent model behind /ledger.
 *
 * Every settled reading becomes one telemetry record on Solana. Kept the naive
 * way, each record is its own rent-exempt account; kept the VENDX way, it is
 * one leaf in a Light Protocol compressed state tree. The per-record figures
 * below are the same two numbers the ledger has always quoted for ten thousand
 * records (48.00 against 0.05 USDC), divided down, so the page and the popup
 * never disagree.
 *
 * This is a model with stated constants, not a reading: rent is priced in SOL
 * and the USDC figure is fixed at the rate those two numbers were set. It is
 * labelled as such wherever it is shown.
 */

export const QUOTED_RECORDS = 10_000;
export const STANDARD_RENT_QUOTED_USDC = 48;
export const COMPRESSED_RENT_QUOTED_USDC = 0.05;

/** USDC of rent one record costs as a standard Solana account. */
export const STANDARD_RENT_PER_RECORD = STANDARD_RENT_QUOTED_USDC / QUOTED_RECORDS; // 0.0048
/** USDC of rent one record costs as a compressed leaf. */
export const COMPRESSED_RENT_PER_RECORD = COMPRESSED_RENT_QUOTED_USDC / QUOTED_RECORDS; // 0.000005
/** USDC kept per record by compressing it. */
export const SAVED_PER_RECORD = STANDARD_RENT_PER_RECORD - COMPRESSED_RENT_PER_RECORD; // 0.004795
/** How many times cheaper compressed storage is. */
export const RENT_MULTIPLE = Math.round(STANDARD_RENT_PER_RECORD / COMPRESSED_RENT_PER_RECORD); // 960

/** The minimum a settled record needs for the model: when, and what it sold for. */
export interface SettledRecord {
  key: string;
  signature: string;
  /** micro-USDC, decimal string — the wire shape. */
  amount: string;
  /** unix seconds */
  timestamp: number;
}

export interface SavingsPoint {
  key: string;
  signature: string;
  timestamp: number;
  /** 1-based position in settlement order (oldest first). */
  index: number;
  /** What the reading sold for, USDC. */
  price: number;
  /** Rent a standard account would have cost for this record, USDC. */
  standard: number;
  /** Rent the compressed record actually costs, USDC. */
  compressed: number;
  /** standard − compressed, USDC. */
  saved: number;
  /** Running totals up to and including this record, USDC. */
  cumRevenue: number;
  cumStandard: number;
  cumCompressed: number;
  cumSaved: number;
}

export interface SavingsSummary {
  /** Oldest first, so lines and running totals read left to right. */
  points: SavingsPoint[];
  count: number;
  revenue: number;
  standard: number;
  compressed: number;
  saved: number;
  /** Rent as a share of what the readings earned: 48 means 48×, 0.05 means 5%. */
  standardOverRevenue: number;
  compressedOverRevenue: number;
}

export function summarizeSavings(records: SettledRecord[]): SavingsSummary {
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);
  let cumRevenue = 0;
  let cumStandard = 0;
  let cumCompressed = 0;
  const points = sorted.map<SavingsPoint>((r, i) => {
    const price = Number(r.amount) / 1e6;
    cumRevenue += price;
    cumStandard += STANDARD_RENT_PER_RECORD;
    cumCompressed += COMPRESSED_RENT_PER_RECORD;
    return {
      key: r.key,
      signature: r.signature,
      timestamp: r.timestamp,
      index: i + 1,
      price,
      standard: STANDARD_RENT_PER_RECORD,
      compressed: COMPRESSED_RENT_PER_RECORD,
      saved: SAVED_PER_RECORD,
      cumRevenue,
      cumStandard,
      cumCompressed,
      cumSaved: cumStandard - cumCompressed,
    };
  });
  const revenue = cumRevenue;
  return {
    points,
    count: points.length,
    revenue,
    standard: cumStandard,
    compressed: cumCompressed,
    saved: cumStandard - cumCompressed,
    standardOverRevenue: revenue > 0 ? cumStandard / revenue : 0,
    compressedOverRevenue: revenue > 0 ? cumCompressed / revenue : 0,
  };
}

/**
 * USDC for people. Six decimals is what the receipt prints (micro-USDC is the
 * unit on the wire); `trim` drops trailing zeros for readouts, keeping at least
 * `min` places so 0.05 does not become 0.
 */
export function usdc(n: number, { max = 6, min = 2, trim = true }: { max?: number; min?: number; trim?: boolean } = {}): string {
  const [w, f = ''] = n.toFixed(max).split('.');
  let frac = f;
  if (trim) while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${Number(w).toLocaleString('en-US')}.${frac}`;
}

/** 48 → "48×", 0.05 → "5%". Rent against revenue, in whichever unit reads. */
export function ratio(r: number): string {
  if (r >= 2) return `${Math.round(r).toLocaleString('en-US')}×`;
  const pct = r * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(pct >= 1 ? 0 : 1)}%`;
}
