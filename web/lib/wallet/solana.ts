/**
 * Browser-side Solana helpers: balances and the x402 payment through Phantom.
 *
 * Loaded lazily (`await import('@/lib/wallet/solana')`) so the wallet shell in
 * the root layout does not ship web3.js on every page.
 *
 * The payment is byte-for-byte the shape agent-buyer/src/wallet.ts `payUsdc`
 * sends and relay-proxy/src/facilitator.ts `verifyOnChain` checks: an
 * idempotent ATA create for the vendor, a `transferChecked` of USDC, and a
 * Memo whose text is the challenge nonce. The receipt is only issued if the
 * vendor's USDC balance rose by at least the price and the memo matches.
 */

import { Buffer } from 'buffer';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { USDC_DECIMALS, USDC_MINT_DEVNET, USDC_MINT_MAINNET, type VendxNetwork } from '@vendx/protocol';
import type { PhantomProvider } from './phantom';

if (typeof globalThis !== 'undefined' && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Rent for a fresh ATA (~2.04M lamports) plus fees, with margin. */
export const MIN_LAMPORTS_FOR_PAYMENT = 3_000_000;

const connections = new Map<string, Connection>();

export function rpcUrl(network: VendxNetwork = 'solana-devnet'): string {
  if (network === 'solana') return clusterApiUrl('mainnet-beta');
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl('devnet');
}

export function getConnection(network: VendxNetwork = 'solana-devnet'): Connection {
  const url = rpcUrl(network);
  let c = connections.get(url);
  if (!c) {
    c = new Connection(url, 'confirmed');
    connections.set(url, c);
  }
  return c;
}

export function usdcMint(network: VendxNetwork = 'solana-devnet'): PublicKey {
  return new PublicKey(network === 'solana' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET);
}

export interface Balances {
  lamports: number;
  usdcMicro: bigint;
  at: number;
}

export async function fetchBalances(address: string, network: VendxNetwork = 'solana-devnet'): Promise<Balances> {
  const conn = getConnection(network);
  const owner = new PublicKey(address);
  const ata = getAssociatedTokenAddressSync(usdcMint(network), owner);
  const [lamports, usdcMicro] = await Promise.all([
    conn.getBalance(owner, 'confirmed'),
    conn
      .getTokenAccountBalance(ata, 'confirmed')
      .then((r) => BigInt(r.value.amount))
      .catch((e: unknown) => {
        // No ATA yet means a zero balance, not an error.
        const msg = e instanceof Error ? e.message : String(e);
        if (/could not find account|Invalid param|not found/i.test(msg)) return 0n;
        throw e;
      }),
  ]);
  return { lamports, usdcMicro, at: Date.now() };
}

export function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  return sol >= 100 ? sol.toFixed(1) : sol >= 1 ? sol.toFixed(3) : sol.toFixed(4);
}

export function formatUsdc(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

export function explorerTx(signature: string, network: VendxNetwork = 'solana-devnet'): string {
  const cluster = network === 'solana' ? '' : '?cluster=devnet';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

export function explorerAddress(address: string, network: VendxNetwork = 'solana-devnet'): string {
  const cluster = network === 'solana' ? '' : '?cluster=devnet';
  return `https://explorer.solana.com/address/${address}${cluster}`;
}

export interface PaymentRequest {
  payer: string;
  payTo: string;
  amountMicroUsdc: string;
  nonce: string;
  network: VendxNetwork;
}

export interface PaymentPreflight {
  ok: boolean;
  reason?: string;
}

export function preflight(req: PaymentRequest, balances: Balances | null): PaymentPreflight {
  if (!balances) return { ok: true };
  const need = BigInt(req.amountMicroUsdc);
  if (balances.usdcMicro < need) {
    return {
      ok: false,
      reason: `need ${formatUsdc(need)} devnet USDC, wallet holds ${formatUsdc(balances.usdcMicro)} (faucet.circle.com)`,
    };
  }
  if (balances.lamports < MIN_LAMPORTS_FOR_PAYMENT) {
    return { ok: false, reason: `need ~${formatSol(MIN_LAMPORTS_FOR_PAYMENT)} devnet SOL for fees (faucet.solana.com)` };
  }
  return { ok: true };
}

/** Build the same transaction agent-buyer sends, unsigned, ready for Phantom. */
export async function buildUsdcPayment(req: PaymentRequest): Promise<{ tx: Transaction; lastValidBlockHeight: number }> {
  const conn = getConnection(req.network);
  const mint = usdcMint(req.network);
  const payer = new PublicKey(req.payer);
  const recipient = new PublicKey(req.payTo);
  const source = getAssociatedTokenAddressSync(mint, payer);
  const destination = getAssociatedTokenAddressSync(mint, recipient);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer, destination, recipient, mint),
    createTransferCheckedInstruction(source, mint, destination, payer, BigInt(req.amountMicroUsdc), USDC_DECIMALS),
    new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(req.nonce, 'utf8') }),
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return { tx, lastValidBlockHeight };
}

export type PaymentPhase = 'build' | 'sign' | 'send' | 'confirm';

/** A payment failure that knows which step it came from, so the UI can say something useful. */
export class PaymentError extends Error {
  constructor(
    public readonly phase: PaymentPhase,
    message: string,
    public readonly signature?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PaymentError';
  }
}

function errText(e: unknown): string {
  if (e instanceof Error) {
    const logs = (e as { logs?: unknown }).logs;
    const tail = Array.isArray(logs) ? logs.filter((l) => typeof l === 'string').slice(-3).join(' | ') : '';
    return tail ? `${e.message} — ${tail}` : e.message;
  }
  return String(e);
}

/**
 * Dry-run on OUR connection before Phantom is even asked. Phantom simulates on
 * whatever network the extension is set to, which may not be devnet; this one
 * is always the cluster the relay will check.
 */
export async function simulatePayment(tx: Transaction, network: VendxNetwork = 'solana-devnet'): Promise<void> {
  const conn = getConnection(network);
  const { value } = await conn.simulateTransaction(tx);
  if (value.err) {
    const logs = (value.logs ?? []).slice(-3).join(' | ');
    throw new PaymentError('build', `would fail on devnet: ${JSON.stringify(value.err)}${logs ? ` — ${logs}` : ''}`);
  }
}

/**
 * Send signed bytes and poll until confirmed. The bytes are re-broadcast every
 * few polls: public devnet RPCs drop transactions without telling anyone, and
 * a re-send of the same signed transaction is idempotent.
 */
export async function sendAndConfirm(
  raw: Uint8Array,
  lastValidBlockHeight: number,
  network: VendxNetwork = 'solana-devnet',
  onSent?: (signature: string) => void,
  intervalMs = 1500,
): Promise<string> {
  const conn = getConnection(network);
  let signature: string;
  try {
    signature = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
  } catch (e) {
    throw new PaymentError('send', errText(e), undefined, { cause: e });
  }
  onSent?.(signature);

  for (let tick = 1; ; tick++) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const s = value[0];
    if (s) {
      if (s.err) throw new PaymentError('confirm', `transaction failed on-chain: ${JSON.stringify(s.err)}`, signature);
      if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return signature;
    }
    const height = await conn.getBlockHeight('confirmed');
    if (height > lastValidBlockHeight) {
      throw new PaymentError('confirm', 'blockhash expired before the transaction confirmed', signature);
    }
    if (tick % 3 === 0) {
      // Same bytes, same signature: harmless if the first send already landed.
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Poll signature status until confirmed, or until the blockhash expires (for wallet-sent transactions). */
export async function confirmSignature(
  signature: string,
  lastValidBlockHeight: number,
  network: VendxNetwork = 'solana-devnet',
  intervalMs = 1500,
): Promise<void> {
  const conn = getConnection(network);
  for (;;) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const s = value[0];
    if (s) {
      if (s.err) throw new PaymentError('confirm', `transaction failed on-chain: ${JSON.stringify(s.err)}`, signature);
      if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return;
    }
    const height = await conn.getBlockHeight('confirmed');
    if (height > lastValidBlockHeight) {
      throw new PaymentError('confirm', 'blockhash expired before the transaction confirmed', signature);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface PaymentResult {
  signature: string;
  explorer: string;
}

/**
 * Pay through Phantom.
 *
 * Preferred path: Phantom only SIGNS (`signTransaction`) and this page sends
 * the bytes on its own devnet connection, then polls and re-broadcasts until
 * confirmed. `signAndSendTransaction` would submit through Phantom's RPC for
 * whatever network the extension is on; with Phantom on mainnet a devnet
 * blockhash is simply unknown there, the send fails with "Blockhash not
 * found", and the user sees a misleading "expired". Older providers without
 * `signTransaction` still take that path.
 *
 * User rejections (code 4001) are rethrown untouched so `isUserRejection`
 * still recognises them.
 */
export async function payWithPhantom(
  provider: PhantomProvider,
  req: PaymentRequest,
  onSent?: (signature: string) => void,
): Promise<PaymentResult> {
  let tx: Transaction;
  let lastValidBlockHeight: number;
  try {
    ({ tx, lastValidBlockHeight } = await buildUsdcPayment(req));
  } catch (e) {
    throw new PaymentError('build', errText(e), undefined, { cause: e });
  }
  await simulatePayment(tx, req.network);

  if (typeof provider.signTransaction === 'function') {
    const signed = await provider.signTransaction(tx);
    const raw = signed.serialize();
    const signature = await sendAndConfirm(raw, lastValidBlockHeight, req.network, onSent);
    return { signature, explorer: explorerTx(signature, req.network) };
  }

  const { signature } = await provider.signAndSendTransaction(tx, { preflightCommitment: 'confirmed' });
  onSent?.(signature);
  await confirmSignature(signature, lastValidBlockHeight, req.network);
  return { signature, explorer: explorerTx(signature, req.network) };
}

/** Map RPC / wallet errors to something a person can act on. */
export function describePaymentError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const phase = e instanceof PaymentError ? e.phase : undefined;
  if (/insufficient lamports|insufficient funds for rent|0x1\b.*lamports/i.test(msg)) return 'not enough devnet SOL for fees (faucet.solana.com)';
  if (/insufficient funds|custom program error: 0x1\b/i.test(msg)) return 'not enough devnet USDC (faucet.circle.com)';
  if (/blockhash/i.test(msg)) {
    if (phase === 'confirm') return 'sent to devnet but not confirmed before its blockhash expired (nothing was charged) — run again';
    if (phase === 'send') return 'the transaction expired before it was sent — approving in Phantom took longer than the ~1 minute window; run again and approve promptly';
    return 'transaction expired before it confirmed — try again';
  }
  if (phase === 'build') return msg;
  return msg;
}
