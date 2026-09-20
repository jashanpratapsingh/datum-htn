import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { USDC_DECIMALS, usdcMintFor, type VendxNetwork } from '@vendx/protocol';

/**
 * Paying for a reading, for real.
 *
 * This is the replacement for `mockSolanaTxSig()` in `wallet.ts`, which is honest
 * about being a placeholder: "in production: call sendAndConfirmTransaction() on
 * @solana/web3.js before posting to /settle". This is that call.
 *
 * Three instructions in one transaction, and each is load-bearing:
 *
 *   1. idempotent create-ATA for the vendor, so a vendor who has never held USDC
 *      can still be paid without a separate setup step;
 *   2. `TransferChecked` signed by the AGENT as delegate, spending the TREASURY's
 *      tokens. The treasury key is not present. This is the whole point of the
 *      allowance design;
 *   3. a Memo carrying the challenge nonce, which is what lets the facilitator
 *      prove this payment was for this challenge rather than replaying an old
 *      transfer against a new one.
 *
 * `TransferChecked` rather than `Transfer` so the token program validates mint and
 * decimals; a decimals mistake on a 6-decimal token is a factor of a million.
 */

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export function memoInstruction(text: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    // The memo program treats every signer key as a required signature; listing
    // the agent keeps the memo attributable to whoever paid.
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, 'utf8'),
  });
}

export interface PayContext {
  connection: Connection;
  network: VendxNetwork;
  /** Whose USDC is being spent. Does NOT sign. */
  treasury: PublicKey;
  /** The delegate doing the spending, and the fee payer. Signs. */
  agent: Keypair;
}

export interface PayResult {
  signature: string;
  amountMicroUsdc: string;
  vendorTokenAccount: string;
  treasuryTokenAccount: string;
}

/**
 * Pay `amountMicroUsdc` to `payTo`, binding the transfer to `nonce`.
 *
 * Throws if the token program rejects the transfer — which is exactly what
 * happens when the delegated allowance is exhausted. Callers should surface that
 * failure rather than hide it; it is the demo's best moment.
 */
export async function payForChallenge(
  ctx: PayContext,
  args: { payTo: string; amountMicroUsdc: string; nonce: string },
): Promise<PayResult> {
  const mint = new PublicKey(usdcMintFor(ctx.network));
  const vendor = new PublicKey(args.payTo);
  const amount = BigInt(args.amountMicroUsdc);
  if (amount <= 0n) throw new RangeError(`refusing to send ${args.amountMicroUsdc} micro-USDC`);

  const fromAta = getAssociatedTokenAddressSync(mint, ctx.treasury);
  const toAta = getAssociatedTokenAddressSync(mint, vendor);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      ctx.agent.publicKey, // payer for the account rent, if it is needed
      toAta,
      vendor,
      mint,
    ),
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      ctx.agent.publicKey, // authority: the delegate, not the owner
      amount,
      USDC_DECIMALS,
    ),
    memoInstruction(args.nonce, ctx.agent.publicKey),
  );

  const signature = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.agent], {
    commitment: 'confirmed',
  });

  return {
    signature,
    amountMicroUsdc: amount.toString(),
    vendorTokenAccount: toAta.toBase58(),
    treasuryTokenAccount: fromAta.toBase58(),
  };
}

/**
 * A stand-in for a settled transfer, used only when VENDX_SETTLEMENT=mock.
 *
 * Returns a deliberately recognisable signature so nobody can mistake a mock run
 * for a real one while reading logs.
 */
export function mockPayment(nonce: string): PayResult {
  return {
    signature: `MOCK${nonce.slice(0, 40).padEnd(40, '0')}`,
    amountMicroUsdc: '0',
    vendorTokenAccount: 'mock',
    treasuryTokenAccount: 'mock',
  };
}
