/**
 * On-chain vendx-zk ledger client.
 *
 * Reads the VendxLedger PDA and, when funded, commits sale batches via
 * commit_batch. Uses @solana/web3.js instruction encoding so we do not
 * require a pre-built Anchor IDL on the critical path — the account layout
 * mirrors solana-ledger/programs/vendx-zk/src/lib.rs.
 *
 * Deployed: false until the program account exists on the configured cluster.
 */
import { createHash } from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
// Sales come from the relay's Store (relay-proxy/src/store); only these fields are committed.
import type { SaleRecord } from './store/types.js';

/** Must match declare_id! / Anchor.toml [programs.devnet]. */
export const VENDX_PROGRAM_ID = new PublicKey(
  process.env.VENDX_PROGRAM_ID ?? '5ECE7er8mcx67kUKMp8rMLMXN1EikbzumhJV9defAd37',
);

const LEDGER_SEED = Buffer.from('vendx-ledger');

/** Borsh-ish layout for VendxLedger (8-byte discriminator + fields). */
export interface LedgerAccount {
  authority: PublicKey;
  totalSettledMicroUsdc: bigint;
  totalBuckets: bigint;
  stateRoot: Uint8Array;
  lastCommitSlot: bigint;
}

export function ledgerPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LEDGER_SEED, authority.toBuffer()],
    VENDX_PROGRAM_ID,
  );
}

export async function programDeployed(conn: Connection): Promise<boolean> {
  const info = await conn.getAccountInfo(VENDX_PROGRAM_ID);
  return info !== null && info.executable;
}

export async function fetchLedger(
  conn: Connection,
  authority: PublicKey,
): Promise<LedgerAccount | null> {
  const [pda] = ledgerPda(authority);
  const info = await conn.getAccountInfo(pda);
  if (!info || info.data.length < 8 + 32 + 8 + 8 + 32 + 8) return null;
  const data = info.data;
  let o = 8; // skip Anchor discriminator
  const authorityBytes = data.subarray(o, o + 32);
  o += 32;
  const totalSettledMicroUsdc = data.readBigUInt64LE(o);
  o += 8;
  const totalBuckets = data.readBigUInt64LE(o);
  o += 8;
  const stateRoot = data.subarray(o, o + 32);
  o += 32;
  const lastCommitSlot = data.readBigUInt64LE(o);
  return {
    authority: new PublicKey(authorityBytes),
    totalSettledMicroUsdc,
    totalBuckets,
    stateRoot: new Uint8Array(stateRoot),
    lastCommitSlot,
  };
}

/** Anchor sighash: first 8 bytes of sha256("global:<name>"). */
function sighash(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

export function initializeIx(authority: PublicKey): TransactionInstruction {
  const [pda] = ledgerPda(authority);
  return new TransactionInstruction({
    programId: VENDX_PROGRAM_ID,
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: sighash('initialize'),
  });
}

function encodeBuckets(sales: readonly SaleRecord[]): Buffer {
  // Vec length (u32 LE) + TelemetryBucket for each
  const parts: Buffer[] = [Buffer.alloc(4)];
  parts[0]!.writeUInt32LE(sales.length, 0);

  for (const s of sales) {
    const buf = Buffer.alloc(8 + 32 + 16 + 8 + 8);
    let o = 0;
    buf.writeBigInt64LE(BigInt(s.timestamp), o);
    o += 8;
    const hash = createHash('sha256').update(s.txSignature).digest();
    hash.copy(buf, o);
    o += 32;
    const nonceBytes = Buffer.from(s.nonce.replace(/-/g, '').slice(0, 32), 'hex');
    nonceBytes.copy(buf, o, 0, Math.min(16, nonceBytes.length));
    o += 16;
    buf.writeBigUInt64LE(BigInt(s.amountMicroUsdc), o);
    o += 8;
    // device_id: first 8 bytes of id hash
    createHash('sha256').update(s.id).digest().subarray(0, 8).copy(buf, o);
    parts.push(buf);
  }
  return Buffer.concat(parts);
}

export function commitBatchIx(
  authority: PublicKey,
  sales: readonly SaleRecord[],
  newStateRoot: Uint8Array,
): TransactionInstruction {
  const [pda] = ledgerPda(authority);
  const buckets = encodeBuckets(sales);
  const root = Buffer.from(newStateRoot);
  const data = Buffer.concat([sighash('commit_batch'), buckets, root]);
  return new TransactionInstruction({
    programId: VENDX_PROGRAM_ID,
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

export function merkleRootOfSales(sales: readonly SaleRecord[]): Uint8Array {
  const h = createHash('sha256');
  for (const s of sales) {
    h.update(s.nonce);
    h.update(s.amountMicroUsdc);
    h.update(s.txSignature);
  }
  return new Uint8Array(h.digest());
}

export interface LedgerStatus {
  programId: string;
  network: string;
  deployed: boolean;
  initialized: boolean;
  authority: string | null;
  onChain: LedgerAccount | null;
  pendingSales: number;
  lastCommitSignature: string | null;
}

let lastCommitSignature: string | null = null;
let lastCommittedCount = 0;

export async function buildLedgerStatus(
  conn: Connection | null,
  authority: PublicKey | null,
  network = 'solana-devnet',
  pendingSales = 0,
): Promise<LedgerStatus> {
  const base: LedgerStatus = {
    programId: VENDX_PROGRAM_ID.toBase58(),
    network,
    deployed: false,
    initialized: false,
    authority: authority?.toBase58() ?? null,
    onChain: null,
    pendingSales,
    lastCommitSignature,
  };
  if (!conn) return base;
  try {
    base.deployed = await programDeployed(conn);
    if (base.deployed && authority) {
      base.onChain = await fetchLedger(conn, authority);
      base.initialized = base.onChain !== null;
    }
  } catch (e) {
    console.warn(`[ledger] status read failed: ${(e as Error).message}`);
  }
  return base;
}

/**
 * Commit unsold batches to the chain. No-op when the program is not deployed
 * or the authority key is missing. `sales` is the relay's settled sales, oldest
 * first (the Store lists newest first; callers reverse it).
 */
export async function maybeCommitBatch(
  conn: Connection,
  authority: Keypair,
  sales: readonly SaleRecord[],
): Promise<{ committed: number; signature: string | null }> {
  if (!(await programDeployed(conn))) {
    return { committed: 0, signature: null };
  }
  const pending = sales.slice(0, Math.min(64, Math.max(0, sales.length - lastCommittedCount)));
  if (pending.length === 0) return { committed: 0, signature: null };

  let ledger = await fetchLedger(conn, authority.publicKey);
  if (!ledger) {
    const tx = new Transaction().add(initializeIx(authority.publicKey));
    await sendAndConfirmTransaction(conn, tx, [authority], { commitment: 'confirmed' });
    ledger = await fetchLedger(conn, authority.publicKey);
  }

  const root = merkleRootOfSales(pending);
  const tx = new Transaction().add(commitBatchIx(authority.publicKey, pending, root));
  const signature = await sendAndConfirmTransaction(conn, tx, [authority], {
    commitment: 'confirmed',
  });
  lastCommitSignature = signature;
  lastCommittedCount = sales.length;
  return { committed: pending.length, signature };
}

/** Start a background loop that tries to commit every `intervalMs`. */
export function startLedgerBatcher(
  conn: Connection,
  authority: Keypair,
  loadSales: () => Promise<readonly SaleRecord[]>,
  intervalMs = 60_000,
): NodeJS.Timeout {
  return setInterval(() => {
    void loadSales()
      .then((sales) => maybeCommitBatch(conn, authority, sales))
      .then((r) => {
        if (r.committed > 0) {
          console.log(`[ledger] committed ${r.committed} buckets  tx=${r.signature?.slice(0, 16)}…`);
        }
      })
      .catch((e: unknown) => {
        console.warn(`[ledger] commit failed: ${(e as Error).message}`);
      });
  }, intervalMs);
}
