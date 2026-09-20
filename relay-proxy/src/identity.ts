/**
 * Who this relay is, for the directory and for scoping nonces.
 *
 * The id is the facilitator's Ed25519 public key (hex): it is what every
 * receipt this relay signs verifies against, so it is stable across restarts
 * and unique per keys/facilitator.json. Two relays sharing a key file would
 * overwrite each other's directory row — the id is printed at startup so that
 * is visible.
 */

import { hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKeys } from './keys.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RelayIdentity {
  relayId: string;
  label: string;
  publicUrl: string;
  /** base64url of the 32-byte public key. */
  facilitatorPubkey: string;
  version: string;
}

let _identity: RelayIdentity | null = null;

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function getRelayIdentity(port?: number): RelayIdentity {
  if (_identity) return _identity;
  const { publicKey } = getKeys();
  const buf = Buffer.from(publicKey);
  _identity = {
    relayId: buf.toString('hex'),
    label: process.env.VENDX_RELAY_LABEL ?? hostname(),
    publicUrl: (process.env.VENDX_PUBLIC_URL ?? `http://localhost:${port ?? process.env.RELAY_PORT ?? 3402}`).replace(/\/+$/, ''),
    facilitatorPubkey: buf.toString('base64url'),
    version: packageVersion(),
  };
  return _identity;
}
