#!/usr/bin/env bash
# Deploy vendx-zk to Solana devnet and initialize the ledger PDA.
# Prefer macOS / Linux — Windows SBF install hit privilege errors here.
set -euo pipefail
cd "$(dirname "$0")/../solana-ledger"

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
: "${HOME:=$HOME}"

PROGRAM_ID="5ECE7er8mcx67kUKMp8rMLMXN1EikbzumhJV9defAd37"
KEYPAIR="target/deploy/vendx_zk-keypair.json"

if [[ ! -f "$KEYPAIR" ]]; then
  echo "missing $KEYPAIR — generate with: solana-keygen new -o $KEYPAIR --no-bip39-passphrase"
  exit 1
fi

echo "Building SBF…"
cargo-build-sbf --manifest-path programs/vendx-zk/Cargo.toml

SO="target/deploy/vendx_zk.so"
if [[ ! -f "$SO" ]]; then
  # cargo-build-sbf may write under target/sbpf-solana-solana/release
  SO=$(find target -name 'vendx_zk.so' | head -n1)
fi
echo "Program binary: $SO"
echo "Deploying as $PROGRAM_ID …"
solana program deploy "$SO" \
  --program-id "$KEYPAIR" \
  --url https://api.devnet.solana.com

echo "Deployed. Set VENDX_RPC_URL=https://api.devnet.solana.com and restart the relay."
echo "Then: curl localhost:3402/api/ledger  → deployed should become true"
