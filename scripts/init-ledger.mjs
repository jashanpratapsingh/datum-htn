/**
 * After `solana program deploy`, create the VendxLedger PDA on devnet.
 *
 * Authority = keys/vendor.json (same wallet the relay batcher uses).
 *
 *   VENDX_RPC_URL=https://api.devnet.solana.com node scripts/init-ledger.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import {
  fetchLedger,
  initializeIx,
  ledgerPda,
  programDeployed,
  VENDX_PROGRAM_ID,
} from '../relay-proxy/dist/ledger.js';

const root = process.env.VENDX_ROOT ?? process.cwd();
const rpc = process.env.VENDX_RPC_URL ?? 'https://api.devnet.solana.com';
const vendorPath = resolve(root, 'keys/vendor.json');

if (!existsSync(vendorPath)) {
  console.error(`missing ${vendorPath} — run npm run keygen first`);
  process.exit(1);
}

const authority = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(vendorPath, 'utf8'))),
);
const conn = new Connection(rpc, 'confirmed');

console.log(`program   ${VENDX_PROGRAM_ID.toBase58()}`);
console.log(`authority ${authority.publicKey.toBase58()}`);
console.log(`rpc       ${rpc}`);

if (!(await programDeployed(conn))) {
  console.error('program not deployed yet — run bash scripts/deploy-ledger.sh on Mac first');
  process.exit(1);
}

const [pda] = ledgerPda(authority.publicKey);
const existing = await fetchLedger(conn, authority.publicKey);
if (existing) {
  console.log(`already initialized  pda=${pda.toBase58()}`);
  console.log(`  buckets=${existing.totalBuckets}  settled=${existing.totalSettledMicroUsdc}`);
  process.exit(0);
}

const bal = await conn.getBalance(authority.publicKey);
if (bal < 50_000_000) {
  console.error(`vendor needs ~0.05 SOL for rent; balance=${bal / 1e9}`);
  console.error(`airdrop: solana airdrop 1 ${authority.publicKey.toBase58()} --url devnet`);
  process.exit(1);
}

const sig = await sendAndConfirmTransaction(
  conn,
  new Transaction().add(initializeIx(authority.publicKey)),
  [authority],
  { commitment: 'confirmed' },
);
console.log(`initialized  pda=${pda.toBase58()}`);
console.log(`tx ${sig}`);
console.log('curl the relay with VENDX_RPC_URL set → /api/ledger should show initialized:true');
