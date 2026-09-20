import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createApproveCheckedInstruction,
  createRevokeInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { USDC_DECIMALS, usdcMintFor, type VendxNetwork } from '@vendx/protocol';

/**
 * The agent's spending limit, enforced by Solana rather than by us.
 *
 * This is the part of VENDX that is not just "an API with a paywall".
 *
 * `policy.ts` already caps the agent at $5 per UTC day, and that cap is real and
 * useful — but it is a number in a JSON file next to code that could be patched,
 * crashed, or restarted. Every "give the AI a budget" implementation is
 * ultimately an `if` statement somewhere.
 *
 * So the treasury also issues the agent a *delegate authority* on its USDC token
 * account via the SPL Token `Approve` instruction, with a hard `delegated_amount`.
 *
 * From then on:
 *
 *   - the agent can move USDC out of the treasury without ever holding the
 *     treasury's private key;
 *   - every transfer it makes decrements the delegated amount, inside the token
 *     program;
 *   - when the allowance is exhausted the *runtime* rejects the transfer. Not our
 *     code. There is no code path in VENDX that can be bribed into allowing it;
 *   - `Revoke` cancels the authority in one transaction.
 *
 * We do not hand the AI the vault. We hand it a keycard, and the bank enforces
 * the limit.
 *
 * Two real constraints worth knowing, both inherent to the primitive:
 *   - a token account has exactly ONE delegate; approving again overwrites it
 *     (and resets the remaining amount), it does not add to it;
 *   - the agent still needs its own small SOL balance to pay transaction fees.
 */

export interface AllowanceContext {
  connection: Connection;
  network: VendxNetwork;
  /** Owner of the USDC being spent. Signs the Approve. */
  treasury: Keypair;
  /** The agent's hot key, which becomes the delegate. */
  agent: PublicKey;
}

export interface AllowanceStatus {
  /** The treasury's USDC associated token account. */
  tokenAccount: string;
  /** Current delegate, or null if none. */
  delegate: string | null;
  /** Remaining allowance in micro-USDC. */
  remainingMicroUsdc: string;
  remainingUsd: number;
  /** Treasury USDC balance, which also bounds what can actually move. */
  balanceMicroUsdc: string;
  balanceUsd: number;
  /** True when the named agent is the delegate and has room to spend. */
  agentCanSpend: boolean;
}

export function treasuryTokenAccount(ctx: AllowanceContext): PublicKey {
  return getAssociatedTokenAddressSync(
    new PublicKey(usdcMintFor(ctx.network)),
    ctx.treasury.publicKey,
  );
}

/**
 * Read the allowance straight off the chain.
 *
 * Deliberately not cached and not mirrored locally. The demo displays this value,
 * so it has to be the chain's opinion, not ours.
 */
export async function allowanceStatus(ctx: AllowanceContext): Promise<AllowanceStatus> {
  const ata = treasuryTokenAccount(ctx);
  const account = await getAccount(ctx.connection, ata);

  const delegate = account.delegate?.toBase58() ?? null;
  const remaining = account.delegatedAmount;
  const isAgent = delegate === ctx.agent.toBase58();

  return {
    tokenAccount: ata.toBase58(),
    delegate,
    remainingMicroUsdc: remaining.toString(),
    remainingUsd: Number(remaining) / 10 ** USDC_DECIMALS,
    balanceMicroUsdc: account.amount.toString(),
    balanceUsd: Number(account.amount) / 10 ** USDC_DECIMALS,
    agentCanSpend: isAgent && remaining > 0n && account.amount > 0n,
  };
}

/**
 * Grant the agent a capped allowance.
 *
 * Uses `ApproveChecked` rather than `Approve` so the mint and decimals are
 * verified by the token program. A plain `Approve` would happily accept a wrong
 * decimals assumption and silently authorise a thousand times the intended
 * amount.
 */
export async function grantAllowance(
  ctx: AllowanceContext,
  capMicroUsdc: bigint,
): Promise<{ signature: string; status: AllowanceStatus }> {
  if (capMicroUsdc <= 0n) throw new RangeError('allowance cap must be positive');

  const mint = new PublicKey(usdcMintFor(ctx.network));
  const ata = treasuryTokenAccount(ctx);

  const tx = new Transaction().add(
    createApproveCheckedInstruction(
      ata,
      mint,
      ctx.agent,
      ctx.treasury.publicKey,
      capMicroUsdc,
      USDC_DECIMALS,
    ),
  );

  const signature = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.treasury], {
    commitment: 'confirmed',
  });
  return { signature, status: await allowanceStatus(ctx) };
}

/** Cancel the agent's authority entirely. */
export async function revokeAllowance(
  ctx: AllowanceContext,
): Promise<{ signature: string; status: AllowanceStatus }> {
  const ata = treasuryTokenAccount(ctx);
  const tx = new Transaction().add(createRevokeInstruction(ata, ctx.treasury.publicKey));
  const signature = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.treasury], {
    commitment: 'confirmed',
  });
  return { signature, status: await allowanceStatus(ctx) };
}
