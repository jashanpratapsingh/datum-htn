/** Where a sold reading came from. Mirrored in web/lib/relay.ts. */
export type SaleSource = 'badge' | 'simulator' | 'esp32c3';

export interface SaleRecord {
  id: string;
  nonce: string;
  amountMicroUsdc: string;
  timestamp: number;
  txSignature: string;
  source: SaleSource;
  /** Set when the sale was settled for a registered node (source esp32c3). */
  deviceId?: string;
}

const sales: SaleRecord[] = [];

export function recordSale(record: SaleRecord): void {
  sales.unshift(record);
  if (sales.length > 1000) sales.length = 1000;
}

export function getSales(): readonly SaleRecord[] {
  return sales;
}
