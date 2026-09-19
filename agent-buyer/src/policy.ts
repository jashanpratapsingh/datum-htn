/**
 * Daily spend policy.
 *
 * The buyer will not spend more than DAY_CAP_MICRO_USDC per UTC day.
 * The cap and running total are persisted to disk so they survive restarts.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LEDGER_FILE = join(__dirname, '../../data/spend-ledger.json');

/** $5.00 per UTC day expressed in micro-USDC (1 USDC = 1 000 000 µUSDC). */
export const DAY_CAP_MICRO_USDC = 5_000_000n;

interface LedgerData {
  date: string;
  spentMicroUsdc: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadLedger(ledgerFile: string): LedgerData {
  try {
    const raw = JSON.parse(readFileSync(ledgerFile, 'utf8')) as LedgerData;
    if (raw.date === todayUtc()) return raw;
  } catch { /* first run or unreadable */ }
  return { date: todayUtc(), spentMicroUsdc: '0' };
}

function saveLedger(ledger: LedgerData, ledgerFile: string): void {
  mkdirSync(dirname(ledgerFile), { recursive: true });
  writeFileSync(ledgerFile, JSON.stringify(ledger));
}

export class SpendPolicy {
  private ledger: LedgerData;
  private readonly ledgerFile: string;

  /** @param ledgerFile Override the ledger path (used in tests to isolate I/O). */
  constructor(ledgerFile?: string) {
    this.ledgerFile = ledgerFile ?? DEFAULT_LEDGER_FILE;
    this.ledger = loadLedger(this.ledgerFile);
  }

  get spentToday(): bigint {
    return BigInt(this.ledger.spentMicroUsdc);
  }

  get remainingToday(): bigint {
    const spent = this.spentToday;
    return spent >= DAY_CAP_MICRO_USDC ? 0n : DAY_CAP_MICRO_USDC - spent;
  }

  canSpend(amountMicroUsdc: bigint): boolean {
    return this.spentToday + amountMicroUsdc <= DAY_CAP_MICRO_USDC;
  }

  recordSpend(amountMicroUsdc: bigint): void {
    this.ledger.spentMicroUsdc = (this.spentToday + amountMicroUsdc).toString();
    saveLedger(this.ledger, this.ledgerFile);
  }
}
