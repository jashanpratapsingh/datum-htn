/**
 * Fund the Solana-track wallets for a real devnet run.
 *
 * - Prints treasury / agent / vendor addresses
 * - Airdrops 1 SOL to the agent over RPC (no Solana CLI needed)
 * - Reports treasury USDC ATA balance so you know when the Circle faucet landed
 *
 * Your one manual step: send Circle devnet USDC to the treasury address at
 * https://faucet.circle.com (mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU).
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { loadOrCreateWallet, usdcMintFor, walletPath } from '@vendx/protocol';

const root = process.env.VENDX_ROOT ?? process.cwd();
const rpcUrl = process.env.VENDX_RPC_URL ?? 'https://api.devnet.solana.com';
const network = process.env.VENDX_NETWORK ?? 'solana-devnet';
const mint = new PublicKey(usdcMintFor(/** @type {'solana-devnet'|'solana'} */ (network)));

const connection = new Connection(rpcUrl, 'confirmed');

function load(role) {
  const kp = loadOrCreateWallet(walletPath(role, root));
  return Keypair.fromSecretKey(kp.secretKey);
}

async function solBalance(pubkey) {
  return (await connection.getBalance(pubkey)) / LAMPORTS_PER_SOL;
}

async function airdropIfNeeded(label, pubkey, minSol = 0.5) {
  const before = await solBalance(pubkey);
  console.log(`${label.padEnd(10)} ${pubkey.toBase58()}  ${before.toFixed(4)} SOL`);
  if (before >= minSol) {
    console.log(`${''.padEnd(10)} already funded (>= ${minSol} SOL)\n`);
    return;
  }
  console.log(`${''.padEnd(10)} requesting 1 SOL airdrop…`);
  try {
    const sig = await connection.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
    const after = await solBalance(pubkey);
    console.log(`${''.padEnd(10)} airdrop ok → ${after.toFixed(4)} SOL  ${sig.slice(0, 16)}…\n`);
  } catch (e) {
    console.error(`${''.padEnd(10)} airdrop FAILED: ${e.message}`);
    console.error(`${''.padEnd(10)} try again later, or use https://faucet.solana.com\n`);
  }
}

async function reportUsdc(label, owner) {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  try {
    const acct = await getAccount(connection, ata);
    const usd = Number(acct.amount) / 1e6;
    console.log(
      `${label.padEnd(10)} USDC ATA ${ata.toBase58()}  ${usd.toFixed(6)} USDC` +
        (acct.delegate ? `  delegate=${acct.delegate.toBase58()} remaining=${Number(acct.delegatedAmount) / 1e6}` : ''),
    );
    return usd;
  } catch {
    console.log(`${label.padEnd(10)} USDC ATA ${ata.toBase58()}  (not created yet — send USDC to the owner address)`);
    return 0;
  }
}

const treasury = load('treasury');
const agent = load('agent');
const vendor = load('vendor');

console.log('VENDX fund  (devnet)\n');
console.log(`RPC        ${rpcUrl}`);
console.log(`mint       ${mint.toBase58()}\n`);

await airdropIfNeeded('agent', agent.publicKey, 0.5);
// Treasury needs a little SOL if we ever create its ATA from this wallet;
// Circle faucet only sends the token — ATA creation still needs rent.
await airdropIfNeeded('treasury', treasury.publicKey, 0.05);
await airdropIfNeeded('vendor', vendor.publicKey, 0.05);

console.log('--- USDC ---');
const usd = await reportUsdc('treasury', treasury.publicKey);
await reportUsdc('vendor', vendor.publicKey);

console.log('\n--- next steps ---');
if (usd < 1) {
  console.log('1. Open https://faucet.circle.com');
  console.log('2. Network: Solana Devnet');
  console.log(`3. Recipient: ${treasury.publicKey.toBase58()}`);
  console.log('4. Request USDC, then re-run: npm run fund');
} else {
  console.log('Treasury has USDC. Grant the agent allowance and run the real demo:');
  console.log('  npm run allowance -- --cap 5');
  console.log('  VENDX_SETTLEMENT=devnet npm run demo:solana');
}
