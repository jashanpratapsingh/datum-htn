export interface SaleRecord {
  id: string;
  nonce: string;
  amountMicroUsdc: string;
  timestamp: number;
  txSignature: string;
  source: 'badge' | 'simulator';
}

const sales: SaleRecord[] = [];

export function recordSale(record: SaleRecord): void {
  sales.unshift(record);
  if (sales.length > 1000) sales.length = 1000;
}

export function getSales(): readonly SaleRecord[] {
  return sales;
}
