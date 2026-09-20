import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';

/**
 * Sealing for agent wallet secret keys (vendx_agent_wallets.secret_enc).
 *
 * AES-256-GCM under VENDX_WALLET_KEK — 32 bytes, base64 — set on Vercel and
 * in ~/.vendx/web.env, never committed. Layout of the sealed blob:
 *   [1 byte version=1][12 byte iv][16 byte tag][ciphertext]
 * kek_id (first 8 hex of sha256(kek)) is stored beside the blob so a rotation
 * knows which key sealed which row. The plaintext lives in memory only for the
 * duration of one tool call.
 */

const VERSION = 1;

export class KeystoreError extends Error {
  constructor(public readonly code: 'kek_unconfigured' | 'kek_mismatch' | 'corrupt', message: string) {
    super(message);
    this.name = 'KeystoreError';
  }
}

function kek(): Buffer {
  const raw = process.env.VENDX_WALLET_KEK;
  if (!raw) throw new KeystoreError('kek_unconfigured', 'VENDX_WALLET_KEK is not set on this deployment');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new KeystoreError('kek_unconfigured', 'VENDX_WALLET_KEK must decode to 32 bytes');
  return key;
}

export function kekId(): string {
  return createHash('sha256').update(kek()).digest('hex').slice(0, 8);
}

export function seal(secret: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek(), iv);
  const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function unseal(blob: Uint8Array, storedKekId: string): Uint8Array {
  if (storedKekId !== kekId()) throw new KeystoreError('kek_mismatch', `row sealed under kek ${storedKekId}, current is ${kekId()}`);
  const b = Buffer.from(blob);
  if (b.length < 1 + 12 + 16 + 1 || b[0] !== VERSION) throw new KeystoreError('corrupt', 'sealed blob has an unknown layout');
  const iv = b.subarray(1, 13);
  const tag = b.subarray(13, 29);
  const ct = b.subarray(29);
  const decipher = createDecipheriv('aes-256-gcm', kek(), iv);
  decipher.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
  } catch {
    throw new KeystoreError('corrupt', 'sealed blob failed authentication');
  }
}

/** A fresh Solana keypair plus its sealed secret, ready for vendx_agent_wallets. */
export function newSealedKeypair(): { pubkey: string; secretEnc: Buffer; kekId: string } {
  const kp = Keypair.generate();
  return { pubkey: kp.publicKey.toBase58(), secretEnc: seal(kp.secretKey), kekId: kekId() };
}

export function keypairFromSealed(blob: Uint8Array, storedKekId: string): Keypair {
  return Keypair.fromSecretKey(unseal(blob, storedKekId));
}

/** Postgres returns bytea as a hex string ("\\x…") through PostgREST. */
export function byteaToBuffer(v: unknown): Buffer {
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === 'string') return Buffer.from(v.startsWith('\\x') ? v.slice(2) : v, 'hex');
  throw new KeystoreError('corrupt', 'secret_enc is neither bytes nor hex');
}

export function bufferToBytea(b: Buffer): string {
  return '\\x' + b.toString('hex');
}
