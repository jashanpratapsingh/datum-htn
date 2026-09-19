/**
 * Buyer wallet.
 *
 * Generates an Ed25519 keypair on first run and persists it so the same
 * "address" is reused across invocations. In production this would be a
 * Solana keypair with a funded USDC ATA; in simulator mode we just need
 * a stable identity and a fake tx signature.
 */

import nacl from 'tweetnacl';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, '../../keys');
const KEYS_FILE = join(KEYS_DIR, 'buyer.json');

export interface BuyerWallet {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  /** hex-encoded public key used as the "address" in this demo */
  address: string;
}

let _wallet: BuyerWallet | null = null;

export function getWallet(): BuyerWallet {
  if (_wallet) return _wallet;

  try {
    const data = JSON.parse(readFileSync(KEYS_FILE, 'utf8')) as {
      publicKey: number[];
      secretKey: number[];
      address: string;
    };
    _wallet = {
      publicKey: new Uint8Array(data.publicKey),
      secretKey: new Uint8Array(data.secretKey),
      address: data.address,
    };
  } catch {
    const kp = nacl.sign.keyPair();
    const address = Buffer.from(kp.publicKey).toString('hex');
    mkdirSync(KEYS_DIR, { recursive: true });
    writeFileSync(
      KEYS_FILE,
      JSON.stringify({
        publicKey: Array.from(kp.publicKey),
        secretKey: Array.from(kp.secretKey),
        address,
      }),
    );
    _wallet = { publicKey: kp.publicKey, secretKey: kp.secretKey, address };
    console.log(`[agent-buyer] generated new buyer wallet: ${address.slice(0, 16)}…`);
  }

  return _wallet;
}

/**
 * Produce a mock Solana transaction signature.
 *
 * In production: call sendAndConfirmTransaction() on @solana/web3.js before
 * posting to /settle. Here we return a random hex string — the simulator
 * accepts it without checking the chain.
 */
export function mockSolanaTxSig(): string {
  return 'SimTx' + randomBytes(29).toString('hex');
}
