#!/usr/bin/env bash
# Cross-language check: the C verifier (same logic + TweetNaCl the ESP32 runs)
# must accept a receipt signed by packages/vendx-protocol, and reject a tampered
# one. This is the load-bearing claim of the whole design, so it gets a test
# that runs on the host without hardware.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cc -O1 -I firmware-vendor/lib/tweetnacl -o "$TMP/xlang" \
   firmware-vendor/test/xlang_verify.c firmware-vendor/lib/tweetnacl/tweetnacl.c

cat > "$TMP/gen.mjs" <<'JS'
import nacl from 'tweetnacl';
import { signReceipt, encodeReceipt, b64uEncode } from './dist/index.js';
const kp = nacl.sign.keyPair();
const body = { v:1, nonce:'9f2c1a4b5e6d7f8091a2b3c4d5e6f701',
  payTo:'FHcgfdUmYMda7P6fqKnnekHoE9gsGH2KygkbiZhWzAHU', amount:'10000',
  signature:'5j7sTESTSIG', network:'solana-devnet', issuedAt:1758240000, expiresAt:1758240300 };
const wire = encodeReceipt(signReceipt(body, kp.secretKey));
console.log(wire); console.log(b64uEncode(kp.publicKey));
const [b,s] = wire.split('.');
const o = JSON.parse(Buffer.from(b,'base64url').toString()); o.amount='1';
console.log(Buffer.from(JSON.stringify(o)).toString('base64url')+'.'+s);
JS
cp "$TMP/gen.mjs" packages/vendx-protocol/.gen.mjs
( cd packages/vendx-protocol && node .gen.mjs > "$TMP/out.txt" )
rm -f packages/vendx-protocol/.gen.mjs

R=$(sed -n 1p "$TMP/out.txt"); P=$(sed -n 2p "$TMP/out.txt"); T=$(sed -n 3p "$TMP/out.txt")

fail=0
if "$TMP/xlang" "$R" "$P" >/dev/null; then echo "PASS  valid receipt accepted"; else echo "FAIL  valid receipt rejected"; fail=1; fi
if "$TMP/xlang" "$T" "$P" >/dev/null 2>&1; then echo "FAIL  tampered receipt ACCEPTED"; fail=1; else echo "PASS  tampered receipt rejected"; fi
exit $fail
