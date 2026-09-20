/**
 * Emit golden receipt vectors for the host-side C++ verifier mirror.
 *
 * Proves packages/vendx-protocol and firmware-vendor/src/verifier.cpp agree on
 * the wire format — NOT that anything ran on silicon.
 *
 *   npm run build -w @vendx/protocol
 *   node packages/vendx-protocol/scripts/gen-vectors.mjs
 *   # then: firmware-vendor/test/run.sh   (needs cc)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import {
  b64uEncode,
  encodeReceipt,
  signReceipt,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../vectors');
mkdirSync(outDir, { recursive: true });

const kp = nacl.sign.keyPair();
const body = {
  v: 1,
  nonce: '9f2c1a4b5e6d7f8091a2b3c4d5e6f701',
  payTo: 'FHcgfdUmYMda7P6fqKnnekHoE9gsGH2KygkbiZhWzAHU',
  amount: '10000',
  signature: '5j7sTESTSIG',
  network: 'solana-devnet',
  issuedAt: 1758240000,
  expiresAt: 1758240300,
};

const valid = encodeReceipt(signReceipt(body, kp.secretKey));
const [b, s] = valid.split('.');
const tamperedBody = JSON.parse(Buffer.from(b, 'base64url').toString());
tamperedBody.amount = '1';
const tampered =
  Buffer.from(JSON.stringify(tamperedBody)).toString('base64url') + '.' + s;

const vectors = {
  generatedAt: new Date().toISOString(),
  note:
    'Host-side golden vectors. firmware-vendor/test/xlang_verify.c must ACCEPT valid and REJECT tampered. This does not claim on-silicon validation.',
  facilitatorPublicKeyB64u: b64uEncode(kp.publicKey),
  facilitatorPublicKeyHex: Buffer.from(kp.publicKey).toString('hex'),
  validReceipt: valid,
  tamperedReceipt: tampered,
  body,
};

writeFileSync(resolve(outDir, 'receipts.json'), JSON.stringify(vectors, null, 2));
console.log(`wrote ${resolve(outDir, 'receipts.json')}`);
console.log(`valid     ${valid.slice(0, 40)}…`);
console.log(`pubkey    ${vectors.facilitatorPublicKeyHex.slice(0, 16)}…`);
