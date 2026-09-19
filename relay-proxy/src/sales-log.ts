import { getSupabase, supabaseEnabled } from './supabase.js';

export interface SaleRecord {
  id: string;
  nonce: string;
  amountMicroUsdc: string;
  timestamp: number;
  txSignature: string;
  source: 'badge' | 'simulator';
}

const sales: SaleRecord[] = [];
let hydrated = false;

/**
 * Load recent sales from Supabase into memory.
 * Safe to call repeatedly; only the first call hits the network.
 */
export async function hydrateSales(): Promise<void> {
  if (hydrated || !supabaseEnabled()) return;
  hydrated = true;
  const db = getSupabase();
  if (!db) return;
  const { data, error } = await db
    .from('vendx_sales')
    .select('id, nonce, amount_micro_usdc, timestamp, tx_signature, source')
    .order('timestamp', { ascending: false })
    .limit(1000);
  if (error) {
    console.warn(`[sales-log] hydrate failed: ${error.message}`);
    return;
  }
  sales.length = 0;
  for (const row of data ?? []) {
    sales.push({
      id: String(row.id),
      nonce: String(row.nonce),
      amountMicroUsdc: String(row.amount_micro_usdc),
      timestamp: Number(row.timestamp),
      txSignature: String(row.tx_signature),
      source: row.source === 'badge' ? 'badge' : 'simulator',
    });
  }
  console.log(`[sales-log] hydrated ${sales.length} sales from Supabase`);
}

export function recordSale(record: SaleRecord): void {
  sales.unshift(record);
  if (sales.length > 1000) sales.length = 1000;

  const db = getSupabase();
  if (!db) return;
  void db
    .from('vendx_sales')
    .upsert({
      id: record.id,
      nonce: record.nonce,
      amount_micro_usdc: record.amountMicroUsdc,
      timestamp: record.timestamp,
      tx_signature: record.txSignature,
      source: record.source,
    })
    .then(({ error }) => {
      if (error) console.warn(`[sales-log] persist failed: ${error.message}`);
    });
}

export function getSales(): readonly SaleRecord[] {
  return sales;
}
