/**
 * Mint the three Solana wallets the real-settlement path needs.
 *
 * Idempotent: an existing wallet is left alone, so re-running never orphans
 * devnet funds you already sent to an address.
 *
 * The facilitator's signing key is NOT created here — relay-proxy/src/keys.ts
 * creates `keys/facilitator.json` on first run and owns it. One facilitator
 * identity, one owner.
 */
import { existsSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { loadOrCreateWallet, walletPath } from '@vendx/protocol';

const ROLES = [
  ['treasury', 'holds the USDC the AI is allowed to spend'],
  ['agent', 'the AI hot key; becomes the capped on-chain delegate'],
  ['vendor', 'the sensor wallet that receives payment'],
];

const root = process.cwd();
const addresses = {};

console.log('VENDX wallets  (keys/, gitignored, devnet only)\n');

for (const [role, purpose] of ROLES) {
  const path = walletPath(role, root);
  const existed = existsSync(path);
  const kp = loadOrCreateWallet(path);
  const address = Keypair.fromSecretKey(kp.secretKey).publicKey.toBase58();
  addresses[role] = address;

  console.log(`${role.padEnd(10)} ${existed ? 'existing' : 'CREATED '}  ${address}`);
  console.log(`${''.padEnd(10)} ${purpose}\n`);
}

console.log('The mock demo needs nothing further:');
console.log('  npm run demo:solana\n');
console.log('For real devnet USDC:');
console.log('  1. fund the AGENT with devnet SOL for transaction fees:');
console.log(`       solana airdrop 1 ${addresses.agent} --url devnet`);
console.log('  2. fund the TREASURY with devnet USDC from https://faucet.circle.com :');
console.log(`       ${addresses.treasury}`);
console.log('  3. grant the capped on-chain allowance:');
console.log('       npm run allowance -w @vendx/agent-buyer -- --cap 5');
console.log('  4. run against the chain:');
console.log('       VENDX_SETTLEMENT=devnet npm run demo:solana');
