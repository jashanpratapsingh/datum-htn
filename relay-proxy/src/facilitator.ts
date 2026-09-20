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
 * Either way the nonce must be one this relay can account for. Two cases:
 *   - the relay issued it (simulator / badge path): it is in the nonce store,
 *     and the receipt is signed over the payTo/amount that were *issued*;
 *   - a registered node minted it (see node-registry.ts): the buyer names the
 *     node (`deviceId`, from the challenge's `extra`), and the receipt is signed
 *     over the node's *registered* payTo and price. The device verifies that
 *     the nonce is one it minted; the relay verifies that the money moved.
 * Never the client's copy of payTo or amount. A transaction signature buys
 * exactly one receipt.
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
import { peekNonce } from './nonce-store.js';
import { claimNodeNonce, findNodeByPayTo, getNode, type NodeView } from './node-registry.js';

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
  /** Which registered node minted the nonce (challenge `extra.deviceId`). Absent for relay-issued nonces. */
  deviceId?: string;
}

export interface SettleOk {
  success: true;
  receipt: string;
  settleHeader: string;
  /** Set when the receipt was issued for a registered node's nonce. */
  node?: { deviceId: string; url: string };
}

export interface SettleErr {
  success: false;
  errorReason: string;
  detail?: string;
}

const usedSignatures = new Set<string>();

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

/** A node-minted nonce: 32 lowercase hex chars (firmware-vendor/src/verifier.cpp, issueNonce). */
const NODE_NONCE_RE = /^[0-9a-f]{32}$/;

/** What the receipt is signed over: from the relay's store, or from a node's registration. */
interface Expectation {
  payTo: string;
  amountMicroUsdc: string;
  node?: NodeView;
}

function expectationFor(req: SettleRequest): Expectation | SettleErr {
  const issued = peekNonce(req.nonce);
  const now = Math.floor(Date.now() / 1000);
  if (issued) {
    if (issued.used) return err('nonce_replayed');
    if (issued.expiresAt < now) return err('nonce_expired');
    return { payTo: issued.payTo, amountMicroUsdc: issued.amountMicroUsdc };
  }

  // Not ours. It can only be a registered node's — and only if the buyer can
  // tell us which one (or the wallet maps to exactly one node).
  const node = req.deviceId ? getNode(req.deviceId) : req.payTo ? findNodeByPayTo(req.payTo) : undefined;
  if (!node) return err('nonce_unknown', req.deviceId ? `no registered node "${req.deviceId}"` : undefined);
  if (!NODE_NONCE_RE.test(req.nonce)) return err('nonce_unknown', 'not a node-minted nonce');
  if (node.nodeState === 'lost') return err('node_lost', `${node.deviceId} last heard from ${node.ageSeconds}s ago`);
  if (req.network && req.network !== node.network) return err('wrong_network', `${node.deviceId} sells on ${node.network}`);
  return { payTo: node.payTo, amountMicroUsdc: node.priceMicroUsdc, node };
}

export async function settle(req: SettleRequest): Promise<SettleOk | SettleErr> {
  const now = Math.floor(Date.now() / 1000);
  const expect = expectationFor(req);
  if ('success' in expect) return expect;
  if (req.payTo && req.payTo !== expect.payTo) {
    return err('wrong_recipient', expect.node ? 'payTo differs from the node\'s registration' : 'payTo differs from the issued challenge');
  }
  if (req.amount && BigInt(req.amount) < BigInt(expect.amountMicroUsdc)) {
    return err('insufficient_amount', expect.node ? 'amount below the node\'s registered price' : 'amount below the issued challenge');
  }
  if (usedSignatures.has(req.txSignature)) return err('signature_reused');

  const network = (req.network || expect.node?.network || 'solana-devnet') as VendxNetwork;
  let payer = 'unverified';
  if (SETTLEMENT_MODE === 'verify') {
    const check = await verifyOnChain(req.txSignature, {
      payTo: expect.payTo,
      amountMicroUsdc: expect.amountMicroUsdc,
      network,
      nonce: req.nonce,
    });
    if (!('ok' in check)) return check;
    payer = check.payer;
  }
  // Claim the node nonce only after the chain check, so a failed payment does
  // not poison the nonce for the buyer's retry.
  if (expect.node && !claimNodeNonce(req.nonce)) return err('nonce_replayed', 'a receipt was already issued for this node nonce');
  usedSignatures.add(req.txSignature);

  const { secretKey } = getKeys();
  const body: ReceiptBody = {
    v: 1,
    nonce: req.nonce,
    payTo: expect.payTo,
    amount: expect.amountMicroUsdc,
    signature: req.txSignature,
    network,
    issuedAt: now,
    expiresAt: now + 300,
  };

  const signed = signReceipt(body, secretKey);

  const settleResp: SettleResponse = {
    success: true,
    transaction: req.txSignature,
    network: body.network,
    payer,
  };

  return {
    success: true,
    receipt: encodeReceipt(signed),
    settleHeader: encodeSettleHeader(settleResp),
    node: expect.node ? { deviceId: expect.node.deviceId, url: expect.node.url } : undefined,
  };
}
