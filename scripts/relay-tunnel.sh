#!/usr/bin/env bash
# Expose the laptop relay (port 3402) to the deployed Vercel site.
#
# The relay must run on the laptop because it owns the badge's USB port, so the
# public site reaches it through a cloudflared "quick tunnel". Quick tunnels
# need no Cloudflare account but the *.trycloudflare.com hostname changes every
# time cloudflared restarts, and NEXT_PUBLIC_RELAY_URL is baked into the Next.js
# build — so a new tunnel always means: update the Vercel env var, redeploy.
#
#   scripts/relay-tunnel.sh up        start tunnel (if needed), point Vercel at it, redeploy
#   scripts/relay-tunnel.sh status    show tunnel URL + relay health through it
#   scripts/relay-tunnel.sh down      stop cloudflared (site falls back to 503 until `up`)
#   scripts/relay-tunnel.sh relays    show the relay list the site is built with
#
# Add a teammate's relay: append `label=https://their-relay` to ~/.vendx/extra-relays
# and run `up` again (it redeploys with the new NEXT_PUBLIC_RELAYS).
#
# Named tunnel (stable hostname): once a zone is on Cloudflare, create the tunnel
# and set VENDX_RELAY_HOST (planned: relay.vendx.biz — see RUNBOOK "Stable
# hostname"). `up` prefers the named hostname whenever it answers and falls back
# to a quick tunnel. With no VENDX_RELAY_HOST set, only the quick tunnel is used.
#
# State lives in ~/.vendx/: cloudflared.log, cloudflared.pid, relay-public-url,
# cloudflared-named.log, cloudflared-named.pid.
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$HOME/.vendx"; mkdir -p "$STATE"
LOG="$STATE/cloudflared.log"; PIDF="$STATE/cloudflared.pid"; URLF="$STATE/relay-public-url"
RELAY_PORT="${RELAY_PORT:-3402}"
NAMED_TUNNEL="${VENDX_NAMED_TUNNEL:-vendx-relay}"
NAMED_HOST="${VENDX_RELAY_HOST:-relay.vendx.biz}"
NLOG="$STATE/cloudflared-named.log"; NPIDF="$STATE/cloudflared-named.pid"

named_pid() { [ -f "$NPIDF" ] && kill -0 "$(cat "$NPIDF")" 2>/dev/null && cat "$NPIDF" || pgrep -f "cloudflared tunnel.*run $NAMED_TUNNEL" | head -1 || true; }
named_healthy() { [ -n "$NAMED_HOST" ] && curl -s -m 8 "https://$NAMED_HOST/health" 2>/dev/null | grep -q '"status"'; }
named_start() {
  [ -f "$HOME/.cloudflared/config.yml" ] || return 0
  if [ -z "$(named_pid)" ]; then
    nohup cloudflared tunnel --no-autoupdate run "$NAMED_TUNNEL" > "$NLOG" 2>&1 &
    echo $! > "$NPIDF"; echo "[tunnel] started named tunnel $NAMED_TUNNEL (pid $!)"; sleep 5
  fi
}

tunnel_pid() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && cat "$PIDF" || pgrep -f "cloudflared tunnel.*localhost:$RELAY_PORT" | head -1 || true; }
tunnel_url() { grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" 2>/dev/null | head -1 || true; }

# Other teams' relays shown alongside ours, one `label=url` per line in
# ~/.vendx/extra-relays. They are appended to NEXT_PUBLIC_RELAYS after ours,
# so re-pointing our tunnel never drops them. See web/lib/relays.ts.
OUR_LABEL="${VENDX_RELAY_LABEL:-jashan}"
relays_value() {
  local v="$OUR_LABEL=$1"
  if [ -s "$STATE/extra-relays" ]; then
    while IFS= read -r line; do [ -n "$line" ] && v="$v,$line"; done < "$STATE/extra-relays"
  fi
  printf '%s' "$v"
}

deploy_url() {
  URL="$1"; echo "$URL" > "$URLF"
  RELAYS_VALUE="$(relays_value "$URL")"
  if [ "$(cat "$URLF.deployed" 2>/dev/null)" = "$RELAYS_VALUE" ]; then
    echo "[tunnel] Vercel already has NEXT_PUBLIC_RELAYS=$RELAYS_VALUE; nothing to redeploy"; return
  fi
  cd "$ROOT/web"
  for env in production preview; do
    vercel env rm NEXT_PUBLIC_RELAY_URL "$env" --yes >/dev/null 2>&1 || true
    printf '%s' "$URL" | vercel env add NEXT_PUBLIC_RELAY_URL "$env" >/dev/null
    vercel env rm NEXT_PUBLIC_RELAYS "$env" --yes >/dev/null 2>&1 || true
    printf '%s' "$RELAYS_VALUE" | vercel env add NEXT_PUBLIC_RELAYS "$env" >/dev/null
  done
  echo "[tunnel] NEXT_PUBLIC_RELAY_URL=$URL, NEXT_PUBLIC_RELAYS=$RELAYS_VALUE (production, preview); redeploying"
  vercel --prod --yes 2>&1 | grep -E "Production|Error|error" || true
  echo "$RELAYS_VALUE" > "$URLF.deployed"
}

cmd_up() {
  named_start
  if named_healthy; then
    echo "[tunnel] named hostname answers: https://$NAMED_HOST"
    deploy_url "https://$NAMED_HOST"
    if [ -n "$(tunnel_pid)" ]; then kill "$(tunnel_pid)" && echo "[tunnel] stopped quick tunnel (no longer needed)"; rm -f "$PIDF"; fi
    return
  fi
  [ -n "$NAMED_HOST" ] && echo "[tunnel] https://$NAMED_HOST does not resolve/answer yet; using a quick tunnel"
  if [ -z "$(tunnel_pid)" ]; then
    : > "$LOG"
    nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$RELAY_PORT" > "$LOG" 2>&1 &
    echo $! > "$PIDF"
    echo "[tunnel] started cloudflared (pid $!)"
    for _ in $(seq 1 30); do [ -n "$(tunnel_url)" ] && break; sleep 1; done
  fi
  URL="$(tunnel_url)"
  [ -n "$URL" ] || { echo "[tunnel] no URL in $LOG"; exit 1; }
  echo "[tunnel] $URL"
  deploy_url "$URL"
}

cmd_status() {
  if [ -n "$NAMED_HOST" ]; then
    local npid; npid="$(named_pid)"
    if [ -n "$npid" ]; then echo "named tunnel $NAMED_TUNNEL: running (pid $npid)"; else echo "named tunnel $NAMED_TUNNEL: not running"; fi
    if named_healthy; then echo "https://$NAMED_HOST: answering"; else echo "https://$NAMED_HOST: not resolving/answering (public NS: $(dig +short NS "${NAMED_HOST#*.}" | head -1 || echo ?))"; fi
  else
    echo "named tunnel: none configured (set VENDX_RELAY_HOST once the zone is on Cloudflare)"
  fi
  local pid; pid="$(tunnel_pid)"
  if [ -n "$pid" ]; then echo "cloudflared: running (pid $pid)"; else echo "cloudflared: not running"; fi
  URL="$(tunnel_url)"; echo "url: ${URL:-none}"
  [ -n "$URL" ] && { printf 'relay via tunnel: '; curl -s -m 10 "$URL/health" || echo "unreachable"; echo; }
  echo "deployed-for: $(cat "$URLF.deployed" 2>/dev/null || echo none)"
}

cmd_down() {
  local npid; npid="$(named_pid)"; [ -n "$npid" ] && kill "$npid" && echo "[tunnel] stopped named tunnel pid $npid"; rm -f "$NPIDF"
  local pid; pid="$(tunnel_pid)"
  [ -n "$pid" ] && kill "$pid" && echo "[tunnel] stopped pid $pid" || echo "[tunnel] not running"
  rm -f "$PIDF"
}

cmd_relays() {
  echo "ours:  $OUR_LABEL=$(cat "$URLF" 2>/dev/null || echo '<not up yet>')"
  echo "extra: $(cat "$STATE/extra-relays" 2>/dev/null | tr '\n' ' ' || true)"
  echo "deployed NEXT_PUBLIC_RELAYS: $(cat "$URLF.deployed" 2>/dev/null || echo none)"
}

case "${1:-status}" in
  up) cmd_up ;; status) cmd_status ;; down) cmd_down ;; relays) cmd_relays ;;
  *) echo "usage: $0 up|status|down|relays"; exit 2 ;;
esac
