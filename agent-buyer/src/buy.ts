/**
 * One purchase, start to finish: 402 → policy → pay → /settle → 200.
 *
 * Shared by the CLI (index.ts) and the MCP server (mcp.ts). Logging goes
 * through `opts.log` and defaults to stderr, because the MCP transport owns
 * stdout. When `apiKey` is set it rides on the 402 GET (so a bad key fails
 * before any money moves) and on /settle (where the sale is attributed).
 */

import {
  selectRequirements,
  decodeReceipt,
  microUsdcToUsd,
  USDC_MINT_DEVNET,
  type PaymentRequiredBody,
} from '@vendx/protocol';
import { SpendPolicy } from './policy.js';
import { FAKE_PAYMENT, buyerUsdcBalance, loadBuyerKeypair, mockSolanaTxSig, payUsdc, solscanUrl } from './wallet.js';

export const AGENT_KEY_HEADER = 'x-vendx-agent-key';
const NETWORK = 'solana-devnet' as const;

export interface BuyOptions {
  relayUrl: string;
  apiKey?: string;
  /** Ceiling for this purchase, in micro-USDC. Defaults to the remaining daily budget. */
  maxMicroUsdc?: bigint;
  log?: (line: string) => void;
}

export interface PurchaseResult {
  telemetry: Record<string, unknown>;
  txSignature: string;
  receipt: string;
  amountMicroUsdc: string;
  payTo: string;
  network: string;
  solscanUrl: string;
  attribution?: string;
  payment: 'solana' | 'fake';
  wallet: string;
}

export class BuyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'BuyError';
  }
}

export async function buyReading(opts: BuyOptions): Promise<PurchaseResult> {
  const log = opts.log ?? ((l: string) => console.error(l));
  const relayUrl = opts.relayUrl.replace(/\/+$/, '');
  const keyHeaders: Record<string, string> = opts.apiKey ? { [AGENT_KEY_HEADER]: opts.apiKey } : {};

  const policy = new SpendPolicy();
  const wallet = loadBuyerKeypair();
  log(`[agent-buyer] wallet: ${wallet.publicKey.toBase58()}`);

  if (!FAKE_PAYMENT) {
    const usdc = await buyerUsdcBalance(NETWORK);
    if (usdc === null) {
      throw new BuyError('buyer_unfunded', 'buyer wallet has no USDC token account on devnet — fund it first (faucet.circle.com)');
    }
    log(`[agent-buyer] USDC balance: $${microUsdcToUsd(usdc.toString()).toFixed(6)}`);
  }
  log(`[agent-buyer] daily budget remaining: $${microUsdcToUsd(policy.remainingToday.toString()).toFixed(4)}`);

  // Step 1: initial request — expect 402
  log(`[agent-buyer] → GET ${relayUrl}/api/telemetry`);
  const res1 = await fetch(`${relayUrl}/api/telemetry`, { headers: keyHeaders });
  if (res1.status === 401) {
    const body = (await res1.json().catch(() => ({}))) as { error?: string; hint?: string };
    throw new BuyError(body.error ?? 'bad_agent_key', body.hint ?? 'the relay rejected the API key');
  }
  if (res1.status !== 402) {
    throw new BuyError('unexpected_status', `expected 402, got ${res1.status}`, await res1.text().catch(() => ''));
  }
  const challenge = (await res1.json()) as PaymentRequiredBody;
  log(`[agent-buyer] ← 402  nonce=${challenge.nonce.slice(0, 8)}…`);

  // Step 2: find an offer within policy
  const cap = opts.maxMicroUsdc !== undefined && opts.maxMicroUsdc < policy.remainingToday ? opts.maxMicroUsdc : policy.remainingToday;
  const req = selectRequirements(challenge, { network: NETWORK, asset: USDC_MINT_DEVNET, maxMicroUsdc: cap });
  if (!req) {
    throw new BuyError('no_acceptable_offer', `no offer within ${cap} µUSDC on ${NETWORK} in USDC`);
  }
  const amount = BigInt(req.maxAmountRequired);
  log(`[agent-buyer] ✓ policy  amount=${req.maxAmountRequired} µUSDC  to=${req.payTo.slice(0, 8)}…`);
  if (!policy.canSpend(amount)) throw new BuyError('daily_cap', 'daily cap would be exceeded');

  // Step 3: pay. Real USDC transfer unless VENDX_FAKE_PAYMENT=1 opts out.
  let txSig: string;
  let payment: PurchaseResult['payment'] = 'solana';
  if (FAKE_PAYMENT) {
    txSig = mockSolanaTxSig();
    payment = 'fake';
    log(`[agent-buyer] → execute  txSig=${txSig.slice(0, 16)}… (FAKE — no payment happened; VENDX_FAKE_PAYMENT=1)`);
  } else {
    log(`[agent-buyer] → transfer ${req.maxAmountRequired} µUSDC to ${req.payTo} on ${req.network} …`);
    const paid = await payUsdc({ payTo: req.payTo, amountMicroUsdc: req.maxAmountRequired, network: req.network, nonce: challenge.nonce });
    txSig = paid.signature;
    log(`[agent-buyer] ✓ confirmed  ${paid.explorer}`);
  }

  // Step 4: settle and receive signed receipt
  log(`[agent-buyer] → POST ${relayUrl}/settle`);
  const settleRes = await fetch(`${relayUrl}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...keyHeaders },
    body: JSON.stringify({ nonce: challenge.nonce, txSignature: txSig, payTo: req.payTo, amount: req.maxAmountRequired, network: req.network }),
  });
  if (!settleRes.ok) {
    const e = (await settleRes.json().catch(() => ({}))) as { errorReason?: string; detail?: string; error?: string };
    throw new BuyError('settle_failed', `settle ${settleRes.status}: ${e.errorReason ?? e.error ?? 'unknown'}`, e.detail);
  }
  const settled = (await settleRes.json()) as { receipt: string; attribution?: string };
  if (!decodeReceipt(settled.receipt)) throw new BuyError('malformed_receipt', 'facilitator returned malformed receipt');
  log(`[agent-buyer] ← receipt  ${settled.receipt.slice(0, 24)}…  attribution=${settled.attribution ?? 'n/a'}`);

  // Record spend before re-requesting (so a crash between settle and re-request
  // doesn't let us use a paid receipt against our own cap).
  policy.recordSpend(amount);

  // Step 5: replay with receipt attached
  log(`[agent-buyer] → GET ${relayUrl}/api/telemetry  (with receipt)`);
  const res2 = await fetch(`${relayUrl}/api/telemetry`, { headers: { 'x-payment-receipt': settled.receipt } });
  if (!res2.ok) {
    const e = await res2.json().catch(() => ({}));
    throw new BuyError('device_rejected', `device rejected receipt (${res2.status})`, e);
  }
  const telemetry = (await res2.json()) as Record<string, unknown>;
  log(`[agent-buyer] ← 200 OK — source=${String(telemetry.source ?? 'unknown')}`);

  return {
    telemetry,
    txSignature: txSig,
    receipt: settled.receipt,
    amountMicroUsdc: req.maxAmountRequired,
    payTo: req.payTo,
    network: req.network,
    solscanUrl: solscanUrl(txSig, req.network),
    attribution: settled.attribution,
    payment,
    wallet: wallet.publicKey.toBase58(),
  };
}
