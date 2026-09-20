export interface SaleRecord {
  id: string;
  nonce: string;
  amountMicroUsdc: string;
  timestamp: number;
  txSignature: string;
  source: 'badge' | 'simulator';
  /** Wallet that paid, as seen on-chain by the facilitator; 'unverified' in trust mode. */
  payer?: string;
}

const sales: SaleRecord[] = [];

export function recordSale(record: SaleRecord): void {
  sales.unshift(record);
  if (sales.length > 1000) sales.length = 1000;
}

export function getSales(): readonly SaleRecord[] {
  return sales;
}

/** UTC calendar day of a unix-seconds timestamp, e.g. "2026-09-20". */
export function utcDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** Sales one wallet paid for on a given UTC day (the relay only knows sales since it started). */
export function salesByPayerOn(payer: string, day: string): readonly SaleRecord[] {
  return sales.filter(s => s.payer === payer && utcDay(s.timestamp) === day);
}
