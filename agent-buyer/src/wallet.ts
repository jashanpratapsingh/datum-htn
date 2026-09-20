/**
 * Buyer wallet: a real Solana keypair that pays USDC on-chain.
 *
 * The keypair is the Solana CLI one by default (~/.config/solana/id.json), or
 * whatever VENDX_BUYER_KEYPAIR points at. It must hold SOL for fees and USDC
 * (devnet: Circle faucet) in its associated token account.
 *
 * `payUsdc` builds one transaction with three instructions:
 *   1. create the recipient's USDC ATA if it does not exist (idempotent; the
 *      buyer pays the rent, so a fresh vendor wallet needs no SOL),
 *   2. transferChecked of the exact challenge amount (6 decimals),
 *   3. a Memo carrying the challenge nonce, so the facilitator can bind this
 *      transaction to this challenge and nobody can reuse it for another.
 * It returns only after the cluster confirms the transaction.
 *
 * `mockSolanaTxSig` survives for VENDX_FAKE_PAYMENT=1 only. A facilitator in
 * its default `verify` mode rejects it; it exists for offline demos against a
 * relay started with VENDX_SETTLEMENT=trust, and every log line says so.
 */

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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { USDC_DECIMALS, USDC_MINT_DEVNET, USDC_MINT_MAINNET, type VendxNetwork } from '@vendx/protocol';

/** SPL Memo program v2. */
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Where a keypair is created when neither VENDX_BUYER_KEYPAIR nor the Solana CLI key exists. */
export const DEFAULT_GENERATED_KEYPAIR = join(homedir(), '.vendx', 'buyer-devnet.json');

/**
 * VENDX_BUYER_KEYPAIR wins; then the Solana CLI keypair if it exists; then a
 * generated one at ~/.vendx/buyer-devnet.json (see ensureBuyerKeypair).
 */
export const BUYER_KEYPAIR_PATH =
  process.env.VENDX_BUYER_KEYPAIR ??
  (existsSync(join(homedir(), '.config', 'solana', 'id.json'))
    ? join(homedir(), '.config', 'solana', 'id.json')
    : DEFAULT_GENERATED_KEYPAIR);

/**
 * Create the buyer keypair when it does not exist yet. Returns `created: true`
 * so callers can print funding instructions: a fresh wallet holds nothing.
 */
export function ensureBuyerKeypair(): { path: string; created: boolean; publicKey: string } {
  if (existsSync(BUYER_KEYPAIR_PATH)) {
    return { path: BUYER_KEYPAIR_PATH, created: false, publicKey: loadBuyerKeypair().publicKey.toBase58() };
  }
  const kp = Keypair.generate();
  mkdirSync(join(BUYER_KEYPAIR_PATH, '..'), { recursive: true });
  writeFileSync(BUYER_KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  _keypair = kp;
  return { path: BUYER_KEYPAIR_PATH, created: true, publicKey: kp.publicKey.toBase58() };
}

export function fundingHints(address?: string): string {
  const addr = address ?? (existsSync(BUYER_KEYPAIR_PATH) ? loadBuyerKeypair().publicKey.toBase58() : '<address>');
  return [
    `Fund the buyer wallet ${addr} on Solana devnet:`,
    `  SOL for fees:   solana airdrop 1 ${addr} --url devnet   (or https://faucet.solana.com)`,
    `  devnet USDC:    https://faucet.circle.com  → Solana Devnet → ${addr}`,
    `  (USDC mint ${USDC_MINT_DEVNET})`,
  ].join('\n');
}

export function solscanUrl(signature: string, network: VendxNetwork): string {
  const cluster = network === 'solana' ? '' : '?cluster=devnet';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

export function rpcUrl(network: VendxNetwork): string {
  return process.env.VENDX_SOLANA_RPC ?? clusterApiUrl(network === 'solana' ? 'mainnet-beta' : 'devnet');
}

export function usdcMint(network: VendxNetwork): PublicKey {
  return new PublicKey(network === 'solana' ? USDC_MINT_MAINNET : USDC_MINT_DEVNET);
}

export function explorerUrl(signature: string, network: VendxNetwork): string {
  const cluster = network === 'solana' ? '' : '?cluster=devnet';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

let _keypair: Keypair | null = null;

/** Solana CLI keypair format: a JSON array of the 64 secret-key bytes. */
export function loadBuyerKeypair(): Keypair {
  if (_keypair) return _keypair;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(BUYER_KEYPAIR_PATH, 'utf8'));
  } catch (err) {
    throw new Error(
      `cannot read buyer keypair at ${BUYER_KEYPAIR_PATH} (set VENDX_BUYER_KEYPAIR): ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(raw) || raw.length !== 64) {
    throw new Error(`${BUYER_KEYPAIR_PATH} is not a 64-byte Solana keypair JSON array`);
  }
  _keypair = Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
  return _keypair;
}

export interface UsdcPayment {
  /** Base58 transaction signature, confirmed at `confirmed` commitment. */
  signature: string;
  /** Buyer wallet address (base58). */
  payer: string;
  explorer: string;
}

/** Buyer's SOL balance in lamports. */
export async function buyerSolBalance(network: VendxNetwork): Promise<bigint> {
  const payer = loadBuyerKeypair();
  const conn = new Connection(rpcUrl(network), 'confirmed');
  return BigInt(await conn.getBalance(payer.publicKey, 'confirmed'));
}

/** Buyer's USDC balance in micro-USDC, or null when the ATA does not exist. */
export async function buyerUsdcBalance(network: VendxNetwork): Promise<bigint | null> {
  const payer = loadBuyerKeypair();
  const conn = new Connection(rpcUrl(network), 'confirmed');
  const ata = getAssociatedTokenAddressSync(usdcMint(network), payer.publicKey);
  try {
    const bal = await conn.getTokenAccountBalance(ata, 'confirmed');
    return BigInt(bal.value.amount);
  } catch {
    return null;
  }
}

export async function payUsdc(opts: {
  payTo: string;
  amountMicroUsdc: string;
  network: VendxNetwork;
  nonce: string;
}): Promise<UsdcPayment> {
  const payer = loadBuyerKeypair();
  const conn = new Connection(rpcUrl(opts.network), 'confirmed');
  const mint = usdcMint(opts.network);
  const recipient = new PublicKey(opts.payTo);
  const source = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const destination = getAssociatedTokenAddressSync(mint, recipient);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destination, recipient, mint),
    createTransferCheckedInstruction(
      source,
      mint,
      destination,
      payer.publicKey,
      BigInt(opts.amountMicroUsdc),
      USDC_DECIMALS,
    ),
    new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(opts.nonce, 'utf8') }),
  );

  const signature = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
  return { signature, payer: payer.publicKey.toBase58(), explorer: explorerUrl(signature, opts.network) };
}

/** Fabricated signature for VENDX_FAKE_PAYMENT=1 only. Rejected by a verifying facilitator. */
export function mockSolanaTxSig(): string {
  return 'SimTx' + randomBytes(29).toString('hex');
}

export const FAKE_PAYMENT = process.env.VENDX_FAKE_PAYMENT === '1';
