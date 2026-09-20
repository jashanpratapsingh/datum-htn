#!/usr/bin/env bash
# Run the laptop relay (relay-proxy, port 3402). Real badge reading is the default.
#
#   scripts/relay.sh up       real mode: poll the conference badge on /dev/cu.usbmodem101,
#                             and only sign receipts for USDC transfers confirmed on-chain
#   scripts/relay.sh demo     demo mode: simulator telemetry, badge poller pointed nowhere,
#                             receipts signed on trust (VENDX_SETTLEMENT=trust) — no wallet needed
#   scripts/relay.sh status   pid, mode, /health, who holds the badge port
#   scripts/relay.sh down     stop the relay
#   scripts/relay.sh logs     tail ~/.vendx/relay.log
#
# `up` and `demo` restart a running relay, so switching modes is one command.
#
# Why `up` may still come up as simulator: two ESP32-C3 badges enumerate as
# /dev/cu.usbmodem101. Only the factory-firmware *conference* badge speaks the
# console the poller reads. The *disposable* badge runs firmware-vendor and is
# owned by scripts/vendor_console.py; opening its port from a second process
# resets the chip. So when another process already holds the port, `up` points
# the poller at a non-existent device and says so loudly. Every payload carries
# `source`, so a simulated reading is never presented as hardware.
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$HOME/.vendx"; mkdir -p "$STATE"
LOG="$STATE/relay.log"; PIDF="$STATE/relay.pid"; MODEF="$STATE/relay.mode"
# Secrets and per-machine settings live outside the repo (chmod 600), never echoed:
#   SUPABASE_URL, SUPABASE_SECRET_KEY  → persistence (nonces, sales, directory survive restarts)
#   VENDX_WEB_SECRET                   → lets the website attribute its purchases to accounts
#   VENDX_RELAY_LABEL                  → how this relay is listed in the directory
if [ -f "$STATE/relay.env" ]; then set -a; . "$STATE/relay.env"; set +a; fi
# How the directory advertises this relay. The tunnel script writes relay-public-url.
PUBLIC_URL="${VENDX_PUBLIC_URL:-$(cat "$STATE/relay-public-url" 2>/dev/null || echo https://relay.vendx.biz)}"
RELAY_PORT="${RELAY_PORT:-3402}"
BADGE_PORT="${VENDX_BADGE_PORT:-/dev/cu.usbmodem101}"
NONE_PORT="/dev/cu.vendx-none"
ENTRY="relay-proxy/dist/index.js"
# Vendor wallet: VENDX_VENDOR_WALLET wins; otherwise the pubkey of the devnet
# vendor keypair the user generated (solana-keygen new -o ~/.vendx/vendor-devnet.json).
VENDOR_KEYPAIR="${VENDX_VENDOR_KEYPAIR:-$STATE/vendor-devnet.json}"
vendor_wallet() {
  if [ -n "${VENDX_VENDOR_WALLET:-}" ]; then printf '%s' "$VENDX_VENDOR_WALLET"; return; fi
  if [ -f "$VENDOR_KEYPAIR" ] && command -v solana-keygen >/dev/null; then solana-keygen pubkey "$VENDOR_KEYPAIR"; fi
}

relay_pid() {
  if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then cat "$PIDF"; return; fi
  pgrep -f "node $ENTRY" | head -1 || true
}
port_holder() { lsof -Fc "$BADGE_PORT" 2>/dev/null | sed -n 's/^c//p' | head -1 || true; }
port_holder_cmd() { lsof -Fp "$BADGE_PORT" 2>/dev/null | sed -n 's/^p//p' | head -1 | xargs -I{} ps -o command= -p {} 2>/dev/null || true; }

stop_relay() {
  local pid; pid="$(relay_pid)"
  if [ -n "$pid" ]; then
    kill "$pid" && echo "[relay] stopped pid $pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  fi
  rm -f "$PIDF"
}

ensure_build() {
  if [ ! -f "$ROOT/$ENTRY" ]; then
    echo "[relay] $ENTRY missing; building relay-proxy"
    (cd "$ROOT/relay-proxy" && npm run build >/dev/null)
  fi
}

start_relay() {  # $1 = poller port, $2 = mode label, $3 = settlement (verify|trust)
  ensure_build
  cd "$ROOT"
  local wallet; wallet="$(vendor_wallet)"
  if [ -z "$wallet" ]; then
    echo "[relay] WARNING: no vendor wallet. Set VENDX_VENDOR_WALLET or create $VENDOR_KEYPAIR;"
    echo "[relay] the relay will quote a placeholder address that nobody controls."
  fi
  if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}" ]; then
    echo "[relay] WARNING: no Supabase credentials in $STATE/relay.env — nonces, sales and the directory"
    echo "[relay] will NOT survive a restart, and agent API keys will not be recognised. See docs/RUNBOOK.md."
  fi
  # `env` so the optional wallet assignment can be produced by expansion.
  # SUPABASE_* and VENDX_WEB_SECRET are inherited from relay.env (set -a above).
  env VENDX_BADGE_PORT="$1" VENDX_SETTLEMENT="$3" RELAY_PORT="$RELAY_PORT" VENDX_PUBLIC_URL="$PUBLIC_URL" \
    ${wallet:+VENDX_VENDOR_WALLET="$wallet"} \
    nohup node "$ENTRY" > "$LOG" 2>&1 &
  echo $! > "$PIDF"; echo "$2" > "$MODEF"
  for _ in $(seq 1 40); do curl -s -m 1 "http://localhost:$RELAY_PORT/health" >/dev/null 2>&1 && break; sleep 0.25; done
  echo "[relay] pid $(cat "$PIDF"), mode=$2, poller=$1, settlement=$3, vendor=${wallet:-<placeholder>}, public=$PUBLIC_URL"
  printf '[relay] /health: '; curl -s -m 3 "http://localhost:$RELAY_PORT/health" || echo "not answering yet (see $LOG)"; echo
}

cmd_up() {
  stop_relay
  if [ ! -e "$BADGE_PORT" ]; then
    echo "[relay] no badge at $BADGE_PORT. Starting in real mode anyway: the poller"
    echo "[relay] picks the conference badge up as soon as it is plugged in; until then"
    echo "[relay] payloads say source=simulator, badgeState=absent."
    start_relay "$BADGE_PORT" real verify; return
  fi
  local holder; holder="$(port_holder)"
  if [ -n "$holder" ]; then
    echo "[relay] WARNING: $BADGE_PORT is held by '$holder' ($(port_holder_cmd))."
    case "$(port_holder_cmd)" in
      *vendor_console*) echo "[relay] That is the disposable vendor node, not the conference badge. It does not";;
      *)                echo "[relay] Two processes on one ESP32-C3 serial port reset the chip. It does not";;
    esac
    echo "[relay] speak the badge console, so real reading is impossible right now."
    echo "[relay] Starting with the poller disabled (mode=simulator). Plug in the conference"
    echo "[relay] badge (a 'badge> ' prompt on the console) and run 'scripts/relay.sh up' again."
    start_relay "$NONE_PORT" "simulator (badge port busy)" verify; return
  fi
  echo "[relay] $BADGE_PORT present and free; polling it for genuine badge telemetry"
  start_relay "$BADGE_PORT" real verify
}

cmd_demo() {
  stop_relay
  echo "[relay] demo mode: simulator telemetry, badge poller disabled, receipts signed on TRUST"
  start_relay "$NONE_PORT" demo trust
}

cmd_status() {
  local pid; pid="$(relay_pid)"
  if [ -n "$pid" ]; then
    echo "relay: running (pid $pid, mode=$(cat "$MODEF" 2>/dev/null || echo '?'))"
    local envs; envs="$(ps eww -o command= -p "$pid" | tr ' ' '\n')"
    echo "poller port: $(printf '%s\n' "$envs" | sed -n 's/^VENDX_BADGE_PORT=//p' | head -1)"
    echo "settlement: $(printf '%s\n' "$envs" | sed -n 's/^VENDX_SETTLEMENT=//p' | head -1)  vendor: $(printf '%s\n' "$envs" | sed -n 's/^VENDX_VENDOR_WALLET=//p' | head -1)"
  else
    echo "relay: not running"
  fi
  printf '/health: '; curl -s -m 3 "http://localhost:$RELAY_PORT/health" || echo "unreachable"; echo
  echo "supabase: ${SUPABASE_URL:+configured ($(printf '%s' "$SUPABASE_URL" | sed -E 's#https?://##'))}${SUPABASE_URL:-not configured (memory only)}"
  if [ -e "$BADGE_PORT" ]; then
    local holder; holder="$(port_holder)"
    echo "badge port $BADGE_PORT: present${holder:+, held by $holder ($(port_holder_cmd))}"
  else
    echo "badge port $BADGE_PORT: absent"
  fi
}

case "${1:-status}" in
  up) cmd_up ;; demo) cmd_demo ;; status) cmd_status ;; down) stop_relay ;;
  logs) tail -n "${2:-40}" -f "$LOG" ;;
  *) echo "usage: $0 up|demo|status|down|logs"; exit 2 ;;
esac
