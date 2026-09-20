/**
 * Facilitator: confirms payments on-chain and issues signed receipts.
 *
 * Default mode is `verify`: before signing, the relay fetches the transaction
 * the buyer names and checks that it succeeded, that the vendor's USDC balance
 * rose by at least the challenge amount, and that its memo is the challenge
 * nonce. A signature-status lookup alone would prove inclusion but not amount
 * or recipient, so the parsed transaction is read instead.
 *
 * VENDX_SETTLEMENT=trust skips the chain and signs whatever it is told. That is
 * the offline demo mode; the settle response then says `payer: "unverified"`.
 *
 * Either way the nonce must be one this relay issued, unused and unexpired, and
 * the receipt is signed over the payTo/amount that were *issued*, not the
 * client's copy. A transaction signature buys exactly one receipt: claiming the
 * signature and recording the sale are one write in the Store, so a receipt
 * can never exist without its sale row, and a retry of the same nonce+tx (a
 * buyer whose first response was dropped) gets the same receipt back.
 */

import { Connection, clusterApiUrl, type ParsedInstruction, type ParsedTransactionWithMeta } from '@solana/web3.js';
import {
  signReceipt,
  encodeReceipt,
  encodeSettleHeader,
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
  type ReceiptBody,
  type SettleResponse,
  type VendxNetwork,
} from '@vendx/protocol';
import { getKeys } from './keys.js';
import type { AgentRef, SaleSource, Store } from './store/types.js';

export type SettlementMode = 'verify' | 'trust';
export const SETTLEMENT_MODE: SettlementMode = process.env.VENDX_SETTLEMENT === 'trust' ? 'trust' : 'verify';

export function rpcUrl(network: VendxNetwork): string {
  return process.env.VENDX_SOLANA_RPC ?? clusterApiUrl(network === 'solana' ? 'mainnet-beta' : 'devnet');
}

export interface SettleRequest {
  nonce: string;
  txSignature: string;
  payTo: string;
  amount: string;
  network: string;
}

/** Who gets credited for the sale, as the request presented it. */
export type Attribution = 'agent' | 'web' | 'anonymous' | 'unknown_key' | 'revoked_key';

export interface SettleContext {
  store: Store;
  sale: {
    relayId: string;
    source: SaleSource;
    /** Fallback when the issued nonce carries no device id. */
    deviceId?: string;
    agent?: AgentRef | null;
    userId?: string | null;
  };
  attribution: Attribution;
}

export interface SettleOk {
  success: true;
  receipt: string;
  settleHeader: string;
  attribution: Attribution;
  /** True when this nonce+signature had already been settled and the earlier receipt is returned. */
  idempotent?: boolean;
  /** Fee payer read from the confirmed transaction; 'unverified' in trust mode. */
  payer: string;
}

export interface SettleErr {
  success: false;
  errorReason: string;
  detail?: string;
}

const err = (errorReason: string, detail?: string): SettleErr => ({ success: false, errorReason, detail });

/** How long to keep asking the RPC for a transaction the buyer says is confirmed. */
const LOOKUP_ATTEMPTS = 6;
const LOOKUP_DELAY_MS = 1500;

interface ChainCheck {
  ok: true;
  payer: string;
}

async function verifyOnChain(
  signature: string,
  expect: { payTo: string; amountMicroUsdc: string; network: VendxNetwork; nonce: string },
): Promise<ChainCheck | SettleErr> {
  const conn = new Connection(rpcUrl(expect.network), 'confirmed');
  const mint = expect.network === 'solana' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;

  let tx: ParsedTransactionWithMeta | null = null;
  for (let i = 0; i < LOOKUP_ATTEMPTS && !tx; i++) {
    try {
      tx = await conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    } catch (e) {
      // Malformed signature strings throw here; a fabricated "SimTx…" lands in this branch.
      return err('payment_not_found', (e as Error).message);
    }
    if (!tx) await new Promise((r) => setTimeout(r, LOOKUP_DELAY_MS));
  }
  if (!tx) return err('payment_not_found', `no confirmed transaction ${signature} on ${expect.network}`);
  if (!tx.meta) return err('payment_not_found', 'transaction has no metadata');
  if (tx.meta.err) return err('payment_failed', JSON.stringify(tx.meta.err));

  const post = tx.meta.postTokenBalances ?? [];
  const pre = tx.meta.preTokenBalances ?? [];
  const dst = post.find((b) => b.owner === expect.payTo && b.mint === mint);
  if (!dst) return err('wrong_recipient', `no USDC balance change for ${expect.payTo}`);
  const before = pre.find((b) => b.accountIndex === dst.accountIndex)?.uiTokenAmount.amount ?? '0';
  const received = BigInt(dst.uiTokenAmount.amount) - BigInt(before);
  if (received < BigInt(expect.amountMicroUsdc)) {
    return err('insufficient_amount', `received ${received} µUSDC, challenge asked ${expect.amountMicroUsdc}`);
  }

  const memo = tx.transaction.message.instructions.find(
    (ix): ix is ParsedInstruction => 'parsed' in ix && ix.program === 'spl-memo',
  );
  if (!memo || memo.parsed !== expect.nonce) {
    return err('memo_mismatch', 'transaction memo must equal the challenge nonce');
  }

  const payer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58() ?? 'unknown';
  return { ok: true, payer };
}

export async function settle(req: SettleRequest, ctx: SettleContext): Promise<SettleOk | SettleErr> {
  const { store } = ctx;
  const issued = await store.peekNonce(req.nonce);
  const now = Math.floor(Date.now() / 1000);
  if (!issued) return err('nonce_unknown');
  if (issued.used) return err('nonce_replayed');
  if (issued.expiresAt < now) return err('nonce_expired');
  if (req.payTo && req.payTo !== issued.payTo) return err('wrong_recipient', 'payTo differs from the issued challenge');
  if (req.amount && BigInt(req.amount) < BigInt(issued.amountMicroUsdc)) {
    return err('insufficient_amount', 'amount below the issued challenge');
  }

  const network = (req.network || 'solana-devnet') as VendxNetwork;
  let payer = 'unverified';
  if (SETTLEMENT_MODE === 'verify') {
    const check = await verifyOnChain(req.txSignature, {
      payTo: issued.payTo,
      amountMicroUsdc: issued.amountMicroUsdc,
      network,
      nonce: req.nonce,
    });
    if (!('ok' in check)) return check;
    payer = check.payer;
  }

  const { secretKey } = getKeys();
  const body: ReceiptBody = {
    v: 1,
    nonce: req.nonce,
    payTo: issued.payTo,
    amount: issued.amountMicroUsdc,
    signature: req.txSignature,
    network,
    issuedAt: now,
    expiresAt: now + 300,
  };

  // Signing is local and pure; the receipt only leaves this process once the
  // settlement is recorded.
  const receipt = encodeReceipt(signReceipt(body, secretKey));

  const recorded = await store.recordSettlement({
    id: req.nonce,
    nonce: req.nonce,
    amountMicroUsdc: issued.amountMicroUsdc,
    timestamp: now,
    txSignature: req.txSignature,
    source: ctx.sale.source,
    deviceId: issued.deviceId || ctx.sale.deviceId,
    relayId: ctx.sale.relayId,
    network,
    payer,
    agentId: ctx.sale.agent?.id ?? null,
    userId: ctx.sale.userId ?? ctx.sale.agent?.userId ?? null,
    receipt,
  });

  const settleResp: SettleResponse = {
    success: true,
    transaction: req.txSignature,
    network: body.network,
    payer,
  };

  if (!recorded.ok) {
    if (recorded.reason === 'signature_reused') {
      if (recorded.priorNonce === req.nonce && recorded.priorReceipt) {
        // Same buyer, same payment, dropped response: hand back the receipt already issued.
        return {
          success: true,
          receipt: recorded.priorReceipt,
          settleHeader: encodeSettleHeader(settleResp),
          attribution: ctx.attribution,
          payer,
          idempotent: true,
        };
      }
      return err('signature_reused');
    }
    return err('nonce_replayed', 'a receipt was already issued for this nonce');
  }

  return {
    success: true,
    receipt,
    settleHeader: encodeSettleHeader(settleResp),
    attribution: ctx.attribution,
    payer,
  };
}
