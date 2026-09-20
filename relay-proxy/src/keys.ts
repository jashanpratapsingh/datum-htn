import nacl from 'tweetnacl';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Where facilitator.json lives. VENDX_KEYS_DIR lets a dev relay carry its own identity beside the production one. */
const KEYS_DIR = process.env.VENDX_KEYS_DIR ?? join(__dirname, '../../keys');
const KEYS_FILE = join(KEYS_DIR, 'facilitator.json');

export interface FacilitatorKeys {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

let _keys: FacilitatorKeys | null = null;

export function getKeys(): FacilitatorKeys {
  if (_keys) return _keys;

  try {
    const data = JSON.parse(readFileSync(KEYS_FILE, 'utf8')) as {
      publicKey: number[];
      secretKey: number[];
    };
    _keys = {
      publicKey: new Uint8Array(data.publicKey),
      secretKey: new Uint8Array(data.secretKey),
    };
  } catch {
    const kp = nacl.sign.keyPair();
    mkdirSync(KEYS_DIR, { recursive: true });
    writeFileSync(
      KEYS_FILE,
      JSON.stringify({
        publicKey: Array.from(kp.publicKey),
        secretKey: Array.from(kp.secretKey),
      }),
    );
    _keys = { publicKey: kp.publicKey, secretKey: kp.secretKey };
    console.log('[relay-proxy] generated new facilitator keypair');
  }

  return _keys;
}
