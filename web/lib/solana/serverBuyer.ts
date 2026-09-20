import 'server-only';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { USDC_DECIMALS, USDC_MINT_DEVNET, type PaymentRequirements } from '@vendx/protocol';

/**
 * The site's shared devnet buyer. Same transaction shape as
 * agent-buyer/src/wallet.ts payUsdc: idempotent ATA create, transferChecked of
 * the exact amount, Memo = challenge nonce. The keypair comes from
 * VENDX_WEB_BUYER_KEYPAIR (a JSON array of 64 bytes), never from disk.
 */

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MAX_MICRO = BigInt(process.env.VENDX_WEB_MAX_MICRO_USDC ?? '100000');

export class BuyGuardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BuyGuardError';
  }
}

export function rpcUrl(): string {
  return process.env.VENDX_SOLANA_RPC ?? clusterApiUrl('devnet');
}

export function loadWebBuyer(): Keypair {
  const raw = process.env.VENDX_WEB_BUYER_KEYPAIR;
  if (!raw) throw new BuyGuardError('buyer_unconfigured', 'VENDX_WEB_BUYER_KEYPAIR is not set on this deployment');
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new BuyGuardError('buyer_unconfigured', 'VENDX_WEB_BUYER_KEYPAIR is not a JSON array');
  }
  if (!Array.isArray(arr) || arr.length !== 64) throw new BuyGuardError('buyer_unconfigured', 'VENDX_WEB_BUYER_KEYPAIR must hold 64 bytes');
  return Keypair.fromSecretKey(Uint8Array.from(arr as number[]));
}

/** What the shared wallet is allowed to pay for: devnet, real USDC mint, a small amount, a real wallet. */
export function assertPayable(req: PaymentRequirements): void {
  if (req.network !== 'solana-devnet') throw new BuyGuardError('not_payable', `the shared wallet only pays on solana-devnet (offer is ${req.network})`);
  if (req.asset !== USDC_MINT_DEVNET) throw new BuyGuardError('not_payable', 'offer is not priced in devnet USDC');
  let amount: bigint;
  try {
    amount = BigInt(req.maxAmountRequired);
  } catch {
    throw new BuyGuardError('not_payable', 'offer amount is not an integer');
  }
  if (amount <= BigInt(0) || amount > MAX_MICRO) throw new BuyGuardError('not_payable', `offer of ${amount} µUSDC exceeds the site cap of ${MAX_MICRO} µUSDC`);
  try {
    new PublicKey(req.payTo);
  } catch {
    throw new BuyGuardError('not_payable', 'payTo is not a valid wallet');
  }
}

export interface WebPayment {
  signature: string;
  payer: string;
  solscanUrl: string;
}

/** SOL and USDC held by a wallet; usdcMicro is null when it has no USDC account yet. */
export async function walletBalances(owner: PublicKey): Promise<{ lamports: bigint; usdcMicro: bigint | null }> {
  const conn = new Connection(rpcUrl(), 'confirmed');
  const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT_DEVNET), owner);
  const [lamports, usdc] = await Promise.all([
    conn.getBalance(owner, 'confirmed'),
    conn.getTokenAccountBalance(ata, 'confirmed').then((r) => BigInt(r.value.amount)).catch(() => null),
  ]);
  return { lamports: BigInt(lamports), usdcMicro: usdc };
}

/**
 * Pay one x402 offer from `payer`: idempotent ATA create for the vendor,
 * transferChecked of the exact amount, Memo = challenge nonce. Used by the
 * site's shared wallet and by every agent wallet the MCP server holds.
 */
export async function payFromKeypair(
  payer: Keypair,
  opts: { payTo: string; amountMicroUsdc: string; nonce: string; confirmMs?: number; who?: string },
): Promise<WebPayment> {
  const who = opts.who ?? 'the wallet';
  const conn = new Connection(rpcUrl(), 'confirmed');
  const mint = new PublicKey(USDC_MINT_DEVNET);
  const recipient = new PublicKey(opts.payTo);
  const source = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const destination = getAssociatedTokenAddressSync(mint, recipient);

  let balance: bigint;
  try {
    balance = BigInt((await conn.getTokenAccountBalance(source, 'confirmed')).value.amount);
  } catch {
    throw new BuyGuardError('buyer_unfunded', `${who} ${payer.publicKey.toBase58()} has no devnet USDC account`);
  }
  if (balance < BigInt(opts.amountMicroUsdc)) {
    throw new BuyGuardError('buyer_unfunded', `${who} holds ${balance} µUSDC, offer needs ${opts.amountMicroUsdc}`);
  }

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destination, recipient, mint),
    createTransferCheckedInstruction(source, mint, destination, payer.publicKey, BigInt(opts.amountMicroUsdc), USDC_DECIMALS),
    new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(opts.nonce, 'utf8') }),
  );

  const confirmMs = opts.confirmMs ?? 45_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const signature = await Promise.race([
      sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BuyGuardError('confirm_timeout', `devnet did not confirm within ${Math.round(confirmMs / 1000)} s`)), confirmMs);
      }),
    ]);
    return { signature, payer: payer.publicKey.toBase58(), solscanUrl: `https://solscan.io/tx/${signature}?cluster=devnet` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function payFromSharedWallet(opts: { payTo: string; amountMicroUsdc: string; nonce: string }): Promise<WebPayment> {
  return payFromKeypair(loadWebBuyer(), { ...opts, who: 'the shared wallet' });
}
