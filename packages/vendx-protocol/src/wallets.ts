import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import nacl from 'tweetnacl';

/**
 * Solana wallet key files, for the real-settlement path.
 *
 * These live alongside the relay's own `keys/facilitator.json` in the same
 * gitignored `keys/` directory, but use a DIFFERENT on-disk format, and the
 * difference is deliberate:
 *
 *   keys/facilitator.json   `{ publicKey: [...], secretKey: [...] }`
 *                           Managed by relay-proxy/src/keys.ts. Only ever used
 *                           to sign receipts, never to hold funds.
 *
 *   keys/treasury.json      `[ ...64 bytes ]`
 *   keys/agent.json         The format `solana-keygen` writes and
 *   keys/vendor.json        `Keypair.fromSecretKey` reads.
 *
 * The wallets have to be in Solana's own format because real money touches
 * them: they get funded from a faucet, inspected with the Solana CLI, and loaded
 * by @solana/web3.js. Inventing our own container for those would mean the
 * operator could not use any standard tool on them.
 *
 * Solana keypairs are Ed25519, the same primitive tweetnacl signs with, so one
 * file serves both purposes without conversion.
 */

export interface VendxKeypair {
  /** 64 bytes: seed followed by public key, the Ed25519 expanded form. */
  secretKey: Uint8Array;
  /** 32 bytes. */
  publicKey: Uint8Array;
}

/** The relay already uses `<root>/keys`; wallets share it rather than adding a second store. */
export function walletsDir(root = process.cwd()): string {
  return resolve(root, 'keys');
}

export function walletPath(name: string, root = process.cwd()): string {
  return resolve(walletsDir(root), `${name}.json`);
}

export function generateWallet(): VendxKeypair {
  const kp = nacl.sign.keyPair();
  return { secretKey: kp.secretKey, publicKey: kp.publicKey };
}

export function saveWallet(path: string, kp: VendxKeypair): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), 'utf8');
}

export function loadWallet(path: string): VendxKeypair {
  if (!existsSync(path)) {
    throw new Error(`wallet file missing: ${path} — run "npm run keygen" first`);
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error(`wallet file ${path} must be a JSON array of 64 bytes`);
  }
  const secretKey = new Uint8Array(parsed as number[]);
  // Derive rather than trust a stored public key, so a truncated or hand-edited
  // file fails loudly here instead of producing silently invalid signatures.
  const derived = nacl.sign.keyPair.fromSecretKey(secretKey);
  return { secretKey, publicKey: derived.publicKey };
}

export function loadOrCreateWallet(path: string): VendxKeypair {
  if (existsSync(path)) return loadWallet(path);
  const kp = generateWallet();
  saveWallet(path, kp);
  return kp;
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/i.test(clean) || clean.length % 2 !== 0) {
    throw new Error('not valid hex');
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}
