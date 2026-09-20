#!/usr/bin/env bash
# End-to-end x402 handshake against a VENDX vendor node (an ESP32 running
# firmware-vendor/) over the network, with the laptop relay as facilitator:
#
#   402 challenge -> POST /settle at the relay -> 200 telemetry
#   -> replayed receipt rejected (nonce_replayed) -> tampered receipt rejected (bad_signature)
#
#   scripts/vendor-handshake.sh http://192.168.4.1 [relay-base-url]
#
# The relay defaults to the facilitator the node names in its challenge
# (`accepts[0].extra.facilitator`, i.e. the URL it registered with), else
# http://localhost:3402. It must hold the keypair whose PUBLIC key was compiled
# into the firmware (scripts/gen-facilitator-key.mjs), and the node must be
# registered with it: the relay settles node-minted nonces only for registered nodes.
#
# The settle step fabricates a transaction signature, so it passes only against
# a relay in trust mode (scripts/relay.sh demo). Against a verifying relay the
# expected result is 402 payment_not_found at step 2 — that is the relay doing
# its job. For a real purchase use agent-buyer (scripts/buy-node.mjs).
set -uo pipefail
DEV="${1:?usage: $0 <device-base-url> [relay-base-url]}"; RELAY_ARG="${2:-}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
step() { printf '%-52s %s\n' "$1" "$2"; }
pass() { step "$1" "PASS  $2"; }
bad()  { step "$1" "FAIL  $2"; fail=1; }

# 1. challenge
code=$(curl -s -m 10 -o "$T/ch.json" -w '%{http_code}' "$DEV/api/telemetry")
if [ "$code" = "402" ]; then pass "GET $DEV/api/telemetry" "402 challenge"; else bad "GET $DEV/api/telemetry" "HTTP $code"; cat "$T/ch.json"; exit 1; fi
eval "$(python3 - "$T/ch.json" <<'PY'
import json,sys,shlex
d=json.load(open(sys.argv[1])); a=d["accepts"][0]; x=a.get("extra") or {}
print("NONCE=%s PAYTO=%s AMOUNT=%s NET=%s DEVID=%s FAC=%s" % (shlex.quote(d["nonce"]), shlex.quote(a["payTo"]), shlex.quote(a["maxAmountRequired"]), shlex.quote(a["network"]), shlex.quote(str(x.get("deviceId",""))), shlex.quote(str(x.get("facilitator","")))))
PY
)"
RELAY="${RELAY_ARG:-${FAC:-http://localhost:3402}}"
step "  challenge" "nonce=${NONCE:0:8}… payTo=${PAYTO:0:8}… amount=$AMOUNT µUSDC network=$NET device=${DEVID:-?} facilitator=$RELAY"

# 2. settle at the relay, naming the node so the relay can account for a nonce it did not mint
TX="SimTx$(date +%s)$RANDOM"
code=$(curl -s -m 10 -o "$T/settle.json" -w '%{http_code}' -H 'content-type: application/json' \
  -d "{\"nonce\":\"$NONCE\",\"txSignature\":\"$TX\",\"payTo\":\"$PAYTO\",\"amount\":\"$AMOUNT\",\"network\":\"$NET\",\"deviceId\":\"$DEVID\"}" "$RELAY/settle")
RECEIPT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("receipt",""))' "$T/settle.json" 2>/dev/null)
if [ "$code" = "200" ] && [ -n "$RECEIPT" ]; then pass "POST $RELAY/settle" "receipt ${#RECEIPT} chars"; else bad "POST $RELAY/settle" "HTTP $code $(cat "$T/settle.json")"; exit 1; fi

# 3. redeem on the device
code=$(curl -s -m 10 -o "$T/tel.json" -w '%{http_code}' -H "X-PAYMENT-RECEIPT: $RECEIPT" "$DEV/api/telemetry")
if [ "$code" = "200" ]; then pass "GET with receipt" "200 $(cat "$T/tel.json")"; else bad "GET with receipt" "HTTP $code $(cat "$T/tel.json")"; fi

# 4. replay must fail
code=$(curl -s -m 10 -o "$T/replay.json" -w '%{http_code}' -H "X-PAYMENT-RECEIPT: $RECEIPT" "$DEV/api/telemetry")
if [ "$code" = "402" ] && grep -q nonce_replayed "$T/replay.json"; then pass "replay same receipt" "402 nonce_replayed"; else bad "replay same receipt" "HTTP $code $(cat "$T/replay.json")"; fi

# 5. tampered signature must fail. Flip the FIRST char of the sig: the last
# char of an 86-char base64url signature only carries padding bits, so
# changing it decodes to the same 64 bytes and the device rightly says
# nonce_replayed instead of bad_signature.
SIG="${RECEIPT##*.}"; BODY="${RECEIPT%.*}"; first="${SIG:0:1}"; [ "$first" = "A" ] && rep="B" || rep="A"
code=$(curl -s -m 10 -o "$T/tamper.json" -w '%{http_code}' -H "X-PAYMENT-RECEIPT: $BODY.$rep${SIG:1}" "$DEV/api/telemetry")
if [ "$code" = "402" ] && grep -q bad_signature "$T/tamper.json"; then pass "tampered signature" "402 bad_signature"; else bad "tampered signature" "HTTP $code $(cat "$T/tamper.json")"; fi

# 6. health
curl -s -m 10 "$DEV/health"; echo
exit $fail
