#!/usr/bin/env bash
# Deploy vendx-zk to Solana devnet (Mac / Linux). Windows cannot run this.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/solana-ledger"

export PATH="${HOME}/.local/share/solana/install/active_release/bin:${HOME}/.cargo/bin:${PATH}"
export HOME="${HOME}"

PROGRAM_ID="5ECE7er8mcx67kUKMp8rMLMXN1EikbzumhJV9defAd37"
KEYPAIR="target/deploy/vendx_zk-keypair.json"

if [[ ! -f "$KEYPAIR" ]]; then
  echo "ERROR: missing $KEYPAIR"
  echo "Copy it from the Windows laptop (AirDrop / USB). Do NOT generate a new one"
  echo "or the program id will no longer match the repo ($PROGRAM_ID)."
  exit 1
fi

echo "==> building SBF"
cargo-build-sbf --manifest-path programs/vendx-zk/Cargo.toml

SO="target/deploy/vendx_zk.so"
if [[ ! -f "$SO" ]]; then
  SO="$(find target -name 'vendx_zk.so' | head -n1)"
fi
if [[ -z "${SO}" || ! -f "$SO" ]]; then
  echo "ERROR: vendx_zk.so not found after build"
  exit 1
fi

echo "==> deploy $SO as $PROGRAM_ID"
solana config set --url https://api.devnet.solana.com
solana program deploy "$SO" \
  --program-id "$KEYPAIR" \
  --url https://api.devnet.solana.com

echo "==> initialize ledger PDA (needs keys/vendor.json + a little SOL)"
cd "$ROOT"
npm run build -w @vendx/relay-proxy
VENDX_RPC_URL=https://api.devnet.solana.com node scripts/init-ledger.mjs

echo ""
echo "DONE. On the laptop / Mac relay:"
echo "  export VENDX_RPC_URL=https://api.devnet.solana.com"
echo "  node relay-proxy/dist/index.js"
echo "  curl -s localhost:3402/api/ledger | jq .deployed,.initialized"
