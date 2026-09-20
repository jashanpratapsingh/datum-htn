import { Connection, Keypair } from '@solana/web3.js';
import { loadOrCreateWallet, walletPath, type VendxNetwork } from '@vendx/protocol';

import {
  allowanceStatus,
  grantAllowance,
  revokeAllowance,
  type AllowanceContext,
} from '../allowance.js';

/**
 * Manage the agent's on-chain spending authority.
 *
 *   allowance                 show the current delegate and remaining amount
 *   allowance --cap 5         approve the agent for 5 USDC
 *   allowance --revoke        cancel the authority entirely
 *
 * Every number printed here is read back from the chain after the transaction
 * confirms, never from local state — the point of the demo is that the chain is
 * the authority, so the CLI must not be able to lie about it.
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  return process.argv[i + 1] ?? '';
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const network = (process.env['VENDX_NETWORK'] ?? 'solana-devnet') as VendxNetwork;
  const rpcUrl = process.env['VENDX_RPC_URL'] ?? 'https://api.devnet.solana.com';
  const root = process.env['VENDX_ROOT'] ?? process.cwd();

  const treasury = Keypair.fromSecretKey(loadOrCreateWallet(walletPath('treasury', root)).secretKey);
  const agent = Keypair.fromSecretKey(loadOrCreateWallet(walletPath('agent', root)).secretKey);

  const ctx: AllowanceContext = {
    connection: new Connection(rpcUrl, 'confirmed'),
    network,
    treasury,
    agent: agent.publicKey,
  };

  console.log(`treasury ${treasury.publicKey.toBase58()}`);
  console.log(`agent    ${agent.publicKey.toBase58()}`);
  console.log(`network  ${network}\n`);

  const show = (label: string, s: Awaited<ReturnType<typeof allowanceStatus>>): void => {
    console.log(`${label}`);
    console.log(`  token account  ${s.tokenAccount}`);
    console.log(`  delegate       ${s.delegate ?? '(none)'}`);
    console.log(`  remaining      ${s.remainingUsd.toFixed(6)} USDC`);
    console.log(`  balance        ${s.balanceUsd.toFixed(6)} USDC`);
    console.log(`  agent can pay  ${s.agentCanSpend ? 'yes' : 'no'}`);
  };

  try {
    if (has('revoke')) {
      const { signature, status } = await revokeAllowance(ctx);
      console.log(`revoked in ${signature}\n`);
      show('after revoke:', status);
      return;
    }

    const cap = arg('cap');
    if (cap !== null) {
      const usd = Number(cap);
      if (!Number.isFinite(usd) || usd <= 0) {
        throw new Error(`--cap needs a positive number of USDC, got "${cap}"`);
      }
      const micro = BigInt(Math.round(usd * 1e6));
      // A token account has exactly one delegate, so this REPLACES any existing
      // approval rather than adding to it.
      const { signature, status } = await grantAllowance(ctx, micro);
      console.log(`approved ${usd} USDC in ${signature}\n`);
      show('after approve:', status);
      return;
    }

    show('current:', await allowanceStatus(ctx));
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`\nfailed: ${msg}`);
    if (/could not find account|TokenAccountNotFound/i.test(msg)) {
      console.error(
        '\nThe treasury has no USDC token account yet. Send devnet USDC to the treasury\n' +
          'address above (https://faucet.circle.com) and try again.',
      );
    }
    process.exit(1);
  }
}

void main();
