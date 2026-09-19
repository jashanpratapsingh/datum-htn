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
const DATA_DIR = join(__dirname, '../../data');
const LEDGER_FILE = join(DATA_DIR, 'spend-ledger.json');

/** $5.00 per UTC day expressed in micro-USDC (1 USDC = 1 000 000 µUSDC). */
export const DAY_CAP_MICRO_USDC = 5_000_000n;

interface LedgerData {
  date: string;
  spentMicroUsdc: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadLedger(): LedgerData {
  try {
    const raw = JSON.parse(readFileSync(LEDGER_FILE, 'utf8')) as LedgerData;
    if (raw.date === todayUtc()) return raw;
  } catch { /* first run or unreadable */ }
  return { date: todayUtc(), spentMicroUsdc: '0' };
}

function saveLedger(ledger: LedgerData): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LEDGER_FILE, JSON.stringify(ledger));
}

export class SpendPolicy {
  private ledger: LedgerData;

  constructor() {
    this.ledger = loadLedger();
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
    saveLedger(this.ledger);
  }
}
