import { Connection, PublicKey } from '@solana/web3.js';
import { usdcMintFor, type VendxNetwork } from '@vendx/protocol';

/**
 * Confirming that money actually moved.
 *
 * This is the piece the simulator path deliberately skips. `relay-proxy/src/
 * facilitator.ts` says so in its own header — in simulator mode it trusts the
 * buyer's reported txSignature, because that demo is about the receipt path. This
 * file is what you use instead when the demo is about the money.
 *
 * Four things must hold before a receipt is signed:
 *
 *   1. the transaction succeeded on the expected network
 *   2. it moved the expected SPL mint (real USDC, not a look-alike)
 *   3. the amount reaching the vendor is at least the quoted price
 *   4. a Memo instruction carries exactly the challenge nonce
 *
 * Check 4 is what binds a payment to a specific challenge. Without it, one
 * settled transfer could be replayed against a second challenge, because the
 * nonce would only ever be asserted by the buyer.
 */

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export interface SettlementRequest {
  signature: string;
  nonce: string;
  /** Vendor wallet owner that must be paid. */
  payTo: string;
  /** Minimum acceptable amount in micro-USDC. */
  amountMicroUsdc: string;
  network: VendxNetwork;
}

export type SettlementFailure =
  | 'tx_not_found'
  | 'tx_failed'
  | 'wrong_mint'
  | 'insufficient_transfer'
  | 'memo_missing'
  | 'memo_mismatch'
  | 'wrong_recipient'
  | 'rpc_error';

export interface SettlementOk {
  ok: true;
  /** Micro-USDC that actually landed with the vendor. */
  observedAmount: string;
  payer: string | null;
  slot: number;
}

export interface SettlementErr {
  ok: false;
  reason: SettlementFailure;
  detail: string;
}

export type SettlementResult = SettlementOk | SettlementErr;

function err(reason: SettlementFailure, detail: string): SettlementErr {
  return { ok: false, reason, detail };
}

interface TokenBalanceLike {
  accountIndex: number;
  mint: string;
  owner?: string | undefined;
  uiTokenAmount: { amount: string };
}

/**
 * Verify a settled transfer on-chain.
 *
 * Uses the transaction's token balance deltas rather than decoding instructions,
 * because that is robust to however the payer chose to construct the transfer —
 * direct, via a delegate, wrapped in other instructions, or batched. What matters
 * is that the vendor's USDC balance went up by enough.
 */
export async function verifySettlement(
  conn: Connection,
  req: SettlementRequest,
): Promise<SettlementResult> {
  const mint = usdcMintFor(req.network);

  let tx;
  try {
    tx = await conn.getTransaction(req.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
  } catch (e) {
    return err('rpc_error', (e as Error).message);
  }
  if (!tx) return err('tx_not_found', `no confirmed transaction ${req.signature}`);
  if (tx.meta?.err) return err('tx_failed', JSON.stringify(tx.meta.err));

  // --- 4. Memo must carry the nonce -------------------------------------
  const memos = extractMemos(tx.meta?.logMessages ?? []);
  if (memos.length === 0) {
    return err('memo_missing', 'no Memo instruction found; cannot bind payment to a challenge');
  }
  if (!memos.some((m) => m.trim() === req.nonce)) {
    return err('memo_mismatch', `memo did not contain nonce ${req.nonce}`);
  }

  // --- 2 & 3. The right mint moved, and enough of it ---------------------
  const pre = (tx.meta?.preTokenBalances ?? []) as TokenBalanceLike[];
  const post = (tx.meta?.postTokenBalances ?? []) as TokenBalanceLike[];
  if (post.length === 0) {
    return err('wrong_mint', 'transaction moved no SPL token balances');
  }
  if (!post.some((b) => b.mint === mint)) {
    const seen = [...new Set(post.map((b) => b.mint))].join(', ');
    return err('wrong_mint', `expected mint ${mint}, saw ${seen}`);
  }

  const credited = creditedTo(pre, post, mint, req.payTo);
  if (credited === null) {
    return err('wrong_recipient', `no ${mint} balance increase for owner ${req.payTo}`);
  }

  const required = BigInt(req.amountMicroUsdc);
  if (credited < required) {
    return err(
      'insufficient_transfer',
      `vendor received ${credited} micro-USDC, needed ${required}`,
    );
  }

  const payer = tx.transaction.message.getAccountKeys().get(0)?.toBase58() ?? null;
  return { ok: true, observedAmount: credited.toString(), payer, slot: tx.slot };
}

/** Balance increase for `owner` in `mint`, or null if that owner is untouched. */
function creditedTo(
  pre: readonly TokenBalanceLike[],
  post: readonly TokenBalanceLike[],
  mint: string,
  owner: string,
): bigint | null {
  let found = false;
  let delta = 0n;

  for (const p of post) {
    if (p.mint !== mint || p.owner !== owner) continue;
    found = true;
    const before = pre.find((x) => x.accountIndex === p.accountIndex);
    delta += BigInt(p.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? '0');
  }
  return found ? delta : null;
}

/**
 * Pull the UTF-8 payloads of every Memo instruction in the transaction.
 *
 * The memo program echoes its input into the logs as:
 *   Program log: Memo (len 32): "9f2c4a..."
 */
function extractMemos(logMessages: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of logMessages) {
    const m = /Memo \(len \d+\): "(.*)"$/.exec(line);
    if (m?.[1] !== undefined) out.push(m[1]);
  }
  return out;
}
